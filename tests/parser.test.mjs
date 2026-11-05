import assert from "node:assert/strict";
import test from "node:test";
import { findDistributionTable, parseNumber, parseStockMeta, parseStockPage } from "../dist-test/core/parser.js";
import { buildTdccPage, createDom, readFixture } from "./helpers/tdcc.mjs";

const parseHtml = (html) => parseStockPage(createDom(html).window.document);

test("parseNumber: 解析千分位、百分比、負數與空白，並拒絕殘缺內容", () => {
    assert.equal(parseNumber(" 2,594,858 "), 2594858);
    assert.equal(parseNumber("84.42"), 84.42);
    assert.equal(parseNumber("100.00%"), 100);
    assert.equal(parseNumber("-4,000"), -4000);
    assert.equal(parseNumber(" 1,476　"), 1476);
    assert.equal(parseNumber(".5"), 0.5);
    // 負零正規化為 0 (strict equal 會區分 -0 與 0)
    assert.ok(Object.is(parseNumber("-0.00"), 0));
    // 無效內容一律回傳 null (parseFloat 會把 "12abc" 解析成 12)
    for (const invalid of ["", "   ", "%", "12abc", "1.2.3", "--", "１２", "N/A", null, undefined]) {
        assert.equal(parseNumber(invalid), null, `應拒絕 ${JSON.stringify(invalid)}`);
    }
});

test("parseStockPage: 正確解析真實 TDCC 回應 (2330 台積電 115/10/22)", () => {
    const result = parseHtml(readFixture("tdcc-2330-20261022.html"));

    assert.equal(result.status, "ok");
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.meta, { stockNo: "2330", stockName: "台積電", dataDate: "115年10月22日" });
    assert.equal(result.levels.length, 15);
    assert.deepEqual(result.levels.map((item) => item.level), Array.from({ length: 15 }, (_, i) => i + 1));
    assert.deepEqual(result.levels[0], { level: 1, holders: 2594858, shares: 303612546, percent: 1.17 });
    assert.deepEqual(result.levels[8], { level: 9, holders: 4149, shares: 289162131, percent: 1.11 });
    assert.deepEqual(result.levels[14], { level: 15, holders: 1476, shares: 21893080824, percent: 84.42 });

    // 第 16 列差異數調整：人數空白、股數為負、比例 -0.00
    assert.deepEqual(result.adjustment, { holders: null, shares: -4000, percent: 0 });
    // 第 17 列合計 (標籤為「合　計」，含全形空白)
    assert.deepEqual(result.total, { holders: 3166709, shares: 25932370067, percent: 100 });

    // 1~15 級股數 + 差異數調整 = 合計股數
    const levelShares = result.levels.reduce((sum, item) => sum + item.shares, 0);
    assert.equal(levelShares + result.adjustment.shares, result.total.shares);
    // 1~15 級人數加總 = 合計人數
    assert.equal(result.levels.reduce((sum, item) => sum + item.holders, 0), result.total.holders);
});

test("parseStockPage: 「查無此資料」回應為 no-data，證券代號取自查詢輸入框回填值", () => {
    const result = parseHtml(readFixture("tdcc-no-data.html"));

    assert.equal(result.status, "no-data");
    assert.deepEqual(result.levels, []);
    assert.equal(result.total, null);
    // 頁面「證券代號：」為空白，代號來自輸入框 value 屬性；名稱與日期不可誤抓查詢表單的標籤
    assert.deepEqual(result.meta, { stockNo: "2330", stockName: null, dataDate: null });
});

test("parseStockPage: 尚未查詢的初始頁面 (只有查詢表單) 為 no-table", () => {
    const result = parseHtml(readFixture("tdcc-initial.html"));

    assert.equal(result.status, "no-table");
    assert.deepEqual(result.levels, []);
});

test("findDistributionTable: 以表頭關鍵字辨識，不會誤抓其他 table.table", () => {
    const html = `<body>
        <table class="table"><thead><tr><th>公告</th><th>日期</th></tr></thead>
            <tbody><tr><td>1</td><td>x</td><td>9</td><td>9</td><td>99</td></tr></tbody></table>
        ${buildTdccPage({ rows: { 1: { holders: 10, shares: 500, percent: 100 } } }).replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "")}
    </body>`;
    const doc = createDom(html).window.document;

    assert.equal(findDistributionTable(doc)?.dataset.testid, "distribution");
    const result = parseStockPage(doc);
    assert.equal(result.levels.length, 1);
    assert.equal(result.levels[0].holders, 10);
});

test("findDistributionTable: 表頭不符時退回第一個 table.table (相容舊版行為)", () => {
    const doc = createDom(`<table><tr><td>表單</td></tr></table>
        <table class="table" id="legacy"><tbody><tr><td>9</td><td>50,001-100,000</td><td>5</td><td>60,000</td><td>1.00</td></tr></tbody></table>`).window.document;

    assert.equal(findDistributionTable(doc)?.id, "legacy");
    assert.equal(parseStockPage(doc).levels[0].level, 9);
});

test("parseStockPage: 略過無效列並保留有效資料", () => {
    const rows = (cells) => cells.map((c) => `<tr>${c.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("");
    const doc = createDom(`<table><thead><tr><th>序</th><th>持股/單位數分級</th><th>人數</th><th>股數/單位數</th><th>占集保庫存數比例 (%)</th></tr></thead><tbody>${rows([
        ["0", "x", "1", "1", "1"], // 級距 0：超出範圍
        ["18", "x", "1", "1", "1"], // 級距 18：超出範圍
        ["abc", "x", "1", "1", "1"], // 級距非數字
        ["1", "1-999", "-1", "10", "1"], // 人數為負
        ["2", "1,000-5,000", "1.5", "10", "1"], // 人數非整數
        ["3", "5,001-10,000", "5", "", ""], // 股數與比例皆空白
        ["4", "10,001-15,000", "7", "", "2.50"], // 股數空白但有比例：保留
        ["5", "15,001-20,000", "8", "-3", "1.00"], // 股數為負：股數視為無效，保留比例
        ["6", "20,001-30,000", "9", "100", "3.00"],
        ["6", "20,001-30,000", "999", "999", "9.99"], // 重複級距：保留第一筆
        ["7", "30,001-40,000", "1"], // 欄位不足
    ])}</tbody></table>`).window.document;

    const result = parseStockPage(doc);

    assert.deepEqual(result.levels, [
        { level: 4, holders: 7, shares: null, percent: 2.5 },
        { level: 5, holders: 8, shares: null, percent: 1 },
        { level: 6, holders: 9, shares: 100, percent: 3 },
    ]);
});

test("parseStockPage: 級距區間與內建定義不符時產生警告", () => {
    const doc = createDom(`<table><thead><tr><th>序</th><th>持股分級</th><th>人數</th><th>股數</th><th>比例</th></tr></thead>
        <tr><td>9</td><td>50,001-80,000</td><td>1</td><td>60,000</td><td>1.00</td></tr>
        <tr><td>10</td><td>90,001-200,000</td><td>1</td><td>100,000</td><td>1.00</td></tr></table>`).window.document;

    const result = parseStockPage(doc);
    assert.equal(result.levels.length, 2);
    assert.deepEqual(result.warnings, ["第 10 級區間「90,001-200,000」與預期不符"]);
});

test("parseStockPage: 列順序錯亂時依級距排序", () => {
    const rows = { 15: { holders: 1, shares: 2000000, percent: 80 }, 1: { holders: 5, shares: 500, percent: 20 } };
    const html = buildTdccPage({ rows }).replace(/(<tr>\s*<td align="center">1<\/td>[\s\S]*?<\/tr>)([\s\S]*?)(<tr>\s*<td align="center">15<\/td>[\s\S]*?<\/tr>)/, "$3$2$1");
    const result = parseHtml(html);

    assert.deepEqual(result.levels.map((item) => item.level), [1, 15]);
});

test("parseStockMeta: 從頁面文字擷取證券資訊，查詢表單標籤 (無全形冒號) 不會被誤判", () => {
    const doc = createDom(`<main>
        <label for="StockNo">證券代號</label><input id="StockNo">
        <p>證券代號：00632R  <br>證券名稱：元大台灣50反1
        </p><span>資料日期：115年10月30日</span>
        <table class="table"></table>
    </main>`).window.document;

    assert.deepEqual(parseStockMeta(doc, doc.querySelector("table")), {
        stockNo: "00632R",
        stockName: "元大台灣50反1",
        dataDate: "115年10月30日",
    });

    // 沒有 <main> 時改從 body 搜尋
    const bodyOnly = createDom(`<div>證券代號：2330</div>`).window.document;
    assert.equal(parseStockMeta(bodyOnly).stockNo, "2330");
});

test("parseStockPage: 沒有差異數調整列的證券 (0050)，「合計」位於第 16 列仍正確辨識", () => {
    const result = parseHtml(readFixture("tdcc-0050-20261030.html"));

    assert.equal(result.status, "ok");
    assert.equal(result.levels.length, 15);
    assert.equal(result.adjustment, null, "第 16 列是合計，不可誤判為差異數調整");
    assert.deepEqual(result.total, { holders: 3741565, shares: 23267000000, percent: 100 });
    assert.deepEqual(result.levels[0], { level: 1, holders: 1592992, shares: 471832453, percent: 2.02 });
    assert.deepEqual(result.meta, { stockNo: "0050", stockName: "元大台灣50", dataDate: "115年10月30日" });

    const levelShares = result.levels.reduce((sum, item) => sum + item.shares, 0);
    assert.equal(levelShares, result.total.shares);
});

test("parseStockPage: 「查無此資料」時以查詢輸入框回填的代號 (HTML value 屬性) 作為證券代號", () => {
    const doc = createDom(readFixture("tdcc-no-data-9999999.html")).window.document;

    assert.equal(parseStockPage(doc).meta.stockNo, "9999999");

    // 使用者在輸入框輸入新代號 (尚未查詢) 不影響結果
    doc.getElementById("StockNo").value = "2330";
    assert.equal(parseStockPage(doc).meta.stockNo, "9999999");
});

test("parseStockPage: 合計 / 差異數調整列的「序」欄空白時仍以文字辨識", () => {
    const fixture = readFixture("tdcc-2330-20261022.html");
    const withoutTotalNo = parseHtml(fixture.replace('<td align="center">17</td>', '<td align="center"></td>'));
    assert.deepEqual(withoutTotalNo.total, { holders: 3166709, shares: 25932370067, percent: 100 });

    const withoutAdjustmentNo = parseHtml(fixture.replace('<td align="center">16</td>', '<td align="center"></td>'));
    assert.deepEqual(withoutAdjustmentNo.adjustment, { holders: null, shares: -4000, percent: 0 });
    assert.equal(withoutAdjustmentNo.levels.length, 15);
});

test("findDistributionTable: 股權分散表被包在版面表格中時選擇內層表格", () => {
    const fixture = readFixture("tdcc-2330-20261022.html");
    // fixture 第 2 行註解含有 "<main>"，必須比對 role 屬性才會包到真正的 <main>
    const wrapped = fixture.replace(
        /<main role="main">([\s\S]*)<\/main>/,
        '<main role="main"><table width="100%" id="layout"><tr><td>$1</td></tr></table></main>',
    );
    const doc = createDom(wrapped).window.document;
    assert.ok(doc.querySelector("#layout table.table"), "前提：股權分散表確實位於版面表格內");

    assert.equal(findDistributionTable(doc)?.className, "table");
    const result = parseStockPage(doc);
    assert.equal(result.status, "ok");
    assert.equal(result.levels.length, 15);
    assert.equal(result.total.shares, 25932370067);
});

test("findDistributionTable: 股權分散表的儲存格內含小表格時仍可辨識", () => {
    const fixture = readFixture("tdcc-2330-20261022.html");
    const withNested = fixture
        .replace("<th>序</th>", "<th>序<table><tr><td>註</td></tr></table></th>")
        .replace("差異數調整（說明4）", "差異數調整（說明4）<table><tr><td>x</td></tr></table>");
    const result = parseHtml(withNested);

    assert.equal(result.status, "ok");
    assert.equal(result.levels.length, 15);
    assert.equal(result.adjustment.shares, -4000);
    assert.equal(result.total.shares, 25932370067);
});

test("parseStockMeta: 壓縮過的 HTML (沒有換行) 不會把資料日期併入證券名稱", () => {
    const doc = createDom(`<main><p>證券代號：2330<br>證券名稱：台積電</p><span>資料日期：115年10月22日</span><table></table></main>`).window.document;

    assert.deepEqual(parseStockMeta(doc), { stockNo: "2330", stockName: "台積電", dataDate: "115年10月22日" });

    // 整份真實頁面去除標籤間空白後 (資料日期緊接著表格文字) 仍只擷取日期
    const minified = readFixture("tdcc-2330-20261022.html").replace(/>\s+</g, "><");
    assert.deepEqual(parseStockPage(createDom(minified).window.document).meta, {
        stockNo: "2330",
        stockName: "台積電",
        dataDate: "115年10月22日",
    });
});
