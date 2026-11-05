import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { mountApp } from "../dist-test/app.js";
import { CONFIG, HOST_ID } from "../dist-test/config/constants.js";
import { createMemoryStore } from "../dist-test/core/settings.js";
import { buildTdccPage, createDom, delay, FIXTURE_DIR, parseOpenDataCsv, readFixture, waitFor } from "./helpers/tdcc.mjs";

const DEBOUNCE = 20;
const SAMPLE = parseOpenDataCsv(fs.readFileSync(path.join(FIXTURE_DIR, "tdcc-opendata-sample.csv"), "utf8"));

/**
 * 在 fixture 頁面上掛載面板並等待初始化完成
 */
async function setup(t, html = readFixture("tdcc-2330-20261022.html"), options = {}) {
    const dom = createDom(html);
    const store = options.store ?? createMemoryStore();
    const app = mountApp({ doc: dom.window.document, store, debounceMs: DEBOUNCE, ...options });
    assert.ok(app, "mountApp 應回傳控制器");
    await app.ready;
    t.after(() => {
        app.destroy();
        dom.window.close();
    });
    return { dom, window: dom.window, doc: dom.window.document, app, el: app.elements, store };
}

const text = (node) => node.textContent.trim();

function change(window, select, value) {
    select.value = String(value);
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
}

function pointer(window, target, type, init) {
    const options = { bubbles: true, cancelable: true, composed: true, button: 0, ...init };
    let event;

    if (typeof window.PointerEvent === "function") {
        event = new window.PointerEvent(type, options);
    } else {
        event = new window.MouseEvent(type, options);
        Object.defineProperty(event, "pointerId", { value: init.pointerId });
    }

    target.dispatchEvent(event);
}

test("掛載後顯示 2330 的大戶、中實戶、散戶 (依股數精算)", async (t) => {
    const { el, doc } = await setup(t);

    assert.equal(doc.querySelectorAll(`#${HOST_ID}`).length, 1);
    assert.ok(el.host.shadowRoot, "面板應位於 Shadow DOM");
    assert.equal(el.panel.style.visibility, "", "設定載入後面板應顯示");

    assert.equal(text(el.subtitle), "2330 台積電 · 115年10月22日");
    assert.equal(text(el.groups.whale.range), "> 1,000 張");
    assert.equal(text(el.groups.whale.percent), "84.42%");
    assert.equal(text(el.groups.whale.holders), "1,476 人（占股東 0.05%）");
    assert.equal(text(el.groups.whale.lots), "21,893,081 張");

    assert.equal(text(el.groups.middle.range), "> 100 ~ ≤ 1,000 張");
    assert.equal(text(el.groups.middle.percent), "5.33%");
    assert.equal(text(el.groups.middle.holders), "4,551 人（占股東 0.14%）");

    assert.equal(text(el.groups.retail.range), "≤ 100 張");
    assert.equal(text(el.groups.retail.percent), "10.24%");
    assert.equal(text(el.groups.retail.holders), "3,160,682 人（占股東 99.81%）");
    assert.equal(el.groups.retail.lots.title, "合計持有張數，平均每人約 0.84 張");

    assert.equal(el.groups.whale.bar.style.width, `${(21893080824 / 25932370067) * 100}%`);
    assert.equal(el.bar.getAttribute("aria-label"), "大戶 84.42%、中實戶 5.33%、散戶 10.24%");
    assert.equal(el.footer.hidden, false);
    assert.equal(text(el.footStatus), "總股東 3,166,709 人");
    assert.match(el.footStatus.title, /無條件捨去/);
    assert.equal(el.notice.hidden, true);
    assert.equal(el.hint.hidden, true);
    assert.equal(el.results.hidden, false);
    assert.equal(el.copyButton.disabled, false);
});

test("下拉選單：預設值、文字，且所有選項皆可選", async (t) => {
    const { el, window } = await setup(t);

    assert.equal(el.whaleSelect.value, "15");
    assert.equal(el.retailSelect.value, "9");
    assert.equal(el.whaleSelect.options.length, 14);
    assert.equal(el.retailSelect.options.length, 14);
    assert.equal(el.whaleSelect.selectedOptions[0].textContent, "> 1,000 張 · 千張大戶");
    assert.equal(el.retailSelect.selectedOptions[0].textContent, "≤ 100 張");
    assert.equal(el.whaleSelect.selectedOptions[0].title, "1,000,001 股以上");
    assert.ok([...el.whaleSelect.options, ...el.retailSelect.options].every((option) => !option.disabled));

    change(window, el.whaleSelect, 12);
    assert.equal(text(el.groups.whale.range), "> 400 張");
    assert.equal(text(el.groups.whale.holders), "2,613 人（占股東 0.08%）");
    assert.equal(text(el.groups.whale.percent), "87.19%");
    assert.equal(text(el.groups.middle.range), "> 100 ~ ≤ 400 張");
    assert.equal(el.hint.hidden, true, "沒有衝突時不顯示調整提示");
});

test("門檻衝突時以剛變更的一方為準，另一方暫時讓位並提示，衝突解除後自動還原", async (t) => {
    const { el, window, app } = await setup(t);
    const levels = () => [app.getSettings().retailLevel, app.getSettings().whaleLevel];

    // 散戶 ≤ 100 張 (第 9 級) 時把大戶改為 > 50 張 (第 9 級) → 散戶暫時改為 ≤ 50 張 (第 8 級)
    change(window, el.whaleSelect, 9);
    assert.deepEqual(levels(), [8, 9]);
    assert.equal(el.retailSelect.value, "8");
    assert.equal(el.hint.hidden, false);
    assert.equal(text(el.hint), "散戶門檻暫時調整為「≤ 50 張」以避免與大戶重疊，大戶門檻調回後自動還原。");
    assert.equal(el.groups.middle.item.hidden, true, "門檻相鄰時隱藏中實戶");
    await waitFor(() => text(el.live) !== "");
    assert.match(text(el.live), /^散戶門檻暫時調整為「≤ 50 張」以避免與大戶重疊，大戶門檻調回後自動還原。大戶 /);

    // 大戶改回 > 1,000 張 → 散戶恢復使用者原本選的 ≤ 100 張，提示消失
    change(window, el.whaleSelect, 15);
    assert.deepEqual(levels(), [9, 15]);
    assert.equal(el.hint.hidden, true);

    // 散戶改為 ≤ 1,000 張 (第 14 級) → 大戶 (原本即為第 15 級) 不需調整
    change(window, el.retailSelect, 14);
    assert.deepEqual(levels(), [14, 15]);
    assert.equal(el.hint.hidden, true);

    // 大戶改為 ≥ 1 張 (第 2 級) → 散戶暫時讓位為第 1 級
    change(window, el.whaleSelect, 2);
    assert.deepEqual(levels(), [1, 2]);
    assert.equal(el.retailSelect.value, "1");

    // 散戶改為第 5 級 → 大戶暫時讓位為第 6 級，並提示大戶門檻調整
    change(window, el.retailSelect, 5);
    assert.deepEqual(levels(), [5, 6]);
    assert.equal(text(el.hint), "大戶門檻暫時調整為「> 20 張」以避免與散戶重疊，散戶門檻調回後自動還原。");

    // 散戶改回第 1 級 → 大戶恢復為使用者選的第 2 級
    change(window, el.retailSelect, 1);
    assert.deepEqual(levels(), [1, 2]);
});

test("以方向鍵瀏覽大戶選項時，散戶門檻不會被永久改掉", async (t) => {
    const { el, window, app, store } = await setup(t);

    for (let whale = 14; whale >= 8; whale -= 1) {
        change(window, el.whaleSelect, whale);
    }
    assert.deepEqual([app.getSettings().retailLevel, app.getSettings().whaleLevel], [7, 8]);

    for (let whale = 9; whale <= 15; whale += 1) {
        change(window, el.whaleSelect, whale);
    }
    assert.deepEqual([app.getSettings().retailLevel, app.getSettings().whaleLevel], [9, 15]);
    assert.equal(el.retailSelect.value, "9");
    await delay(0);
    assert.deepEqual([store.data.retailLevel, store.data.whaleLevel], [9, 15]);
});

test("變更門檻後以 aria-live 播報新比例", async (t) => {
    const { el, window } = await setup(t);

    change(window, el.whaleSelect, 12);
    await waitFor(() => text(el.live) !== "");
    assert.equal(text(el.live), "大戶 87.19%，散戶 10.24%");
});

test("設定會保存，且下次載入時套用 (TDCC 查詢為整頁重新載入)", async (t) => {
    const store = createMemoryStore();
    const first = await setup(t, undefined, { store });
    change(first.window, first.el.whaleSelect, 12);
    change(first.window, first.el.retailSelect, 8);
    first.el.header.click();
    await delay(0);

    assert.deepEqual(
        { retail: store.data.retailLevel, whale: store.data.whaleLevel, collapsed: store.data.collapsed },
        { retail: 8, whale: 12, collapsed: true },
    );

    const second = await setup(t, undefined, { store });
    assert.equal(second.el.whaleSelect.value, "12");
    assert.equal(second.el.retailSelect.value, "8");
    assert.ok(second.el.panel.classList.contains("is-collapsed"));
    assert.equal(second.el.body.hidden, true);
    assert.equal(second.el.toggleButton.getAttribute("aria-expanded"), "false");
    // 收合摘要標示門檻定義，避免把 400 張大戶的數字誤認為千張大戶
    assert.equal(text(second.el.title), "2330 台積電 · 115/10/22");
    assert.equal(text(second.el.subtitle), "400張大戶 87.19% · ≤50張散戶 9.13%");
});

test("收合 / 展開：標題列點擊、按鈕只切換一次、aria 屬性同步", async (t) => {
    const { el, app } = await setup(t);

    el.header.click();
    assert.equal(app.getSettings().collapsed, true);
    assert.equal(el.toggleButton.getAttribute("aria-expanded"), "false");
    assert.equal(el.toggleButton.getAttribute("aria-label"), "展開面板");
    assert.equal(text(el.title), "2330 台積電 · 115/10/22");
    assert.equal(text(el.subtitle), "千張大戶 84.42% · ≤100張散戶 10.24%");

    el.toggleButton.click();
    assert.equal(app.getSettings().collapsed, false);
    assert.equal(el.toggleButton.getAttribute("aria-expanded"), "true");
    assert.equal(text(el.title), "持股比例統計");
    assert.equal(text(el.subtitle), "2330 台積電 · 115年10月22日");
});

test("Esc：僅在焦點位於面板內時收合，並把焦點移到切換按鈕", async (t) => {
    const { el, app, window, doc } = await setup(t);
    const escape = (target, init = {}) =>
        target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true, ...init }));

    // 頁面其他位置 (例如 TDCC 證券代號輸入框) 的 Esc 不應影響面板
    escape(doc.body);
    assert.equal(app.getSettings().collapsed, false);

    // 輸入法組字中的 Esc 不處理
    escape(el.whaleSelect, { isComposing: true });
    assert.equal(app.getSettings().collapsed, false);

    el.whaleSelect.focus();
    escape(el.whaleSelect);
    assert.equal(app.getSettings().collapsed, true);
    assert.equal(el.root.activeElement, el.toggleButton);
});

test("閒置時不會重複解析或重繪 (修正舊版 MutationObserver 無限迴圈)", async (t) => {
    const { app, doc, window } = await setup(t);
    let tableQueries = 0;
    const original = window.Document.prototype.querySelectorAll;
    window.Document.prototype.querySelectorAll = function (selector) {
        if (selector === "table") {
            tableQueries += 1;
        }
        return original.call(this, selector);
    };
    t.after(() => {
        window.Document.prototype.querySelectorAll = original;
    });

    const renders = app.getRenderCount();
    await delay(400);
    assert.equal(tableQueries, 0, "閒置時不應重新解析");
    assert.equal(app.getRenderCount(), renders, "閒置時不應重繪");

    // 與表格無關的頁面變動 (例如 TDCC 自動完成選單) 只會觸發一次去抖動後的解析，且資料不變時不重繪
    for (let i = 0; i < 5; i += 1) {
        doc.body.appendChild(doc.createElement("div"));
    }
    await waitFor(() => tableQueries >= 1);
    await delay(DEBOUNCE * 5);
    assert.equal(tableQueries, 1, "連續變動應合併為一次解析");
    assert.equal(app.getRenderCount(), renders, "資料未變時不應重繪");
});

test("表格內容被替換時自動重新計算 (例如頁面以 AJAX 更新)", async (t) => {
    const { app, doc, el } = await setup(t);
    const renders = app.getRenderCount();
    const { date, rows } = SAMPLE.get("2317");

    doc.querySelector("main").innerHTML = buildTdccPage({ stockNo: "2317", stockName: "鴻海", dataDate: date, rows })
        .replace(/^[\s\S]*<main role="main">|<\/main>[\s\S]*$/g, "");
    await waitFor(() => app.getRenderCount() > renders);
    await delay(DEBOUNCE * 3);

    assert.equal(app.getRenderCount(), renders + 1);
    assert.equal(text(el.subtitle), `2317 鴻海 · ${date}`);
    const whaleShares = rows[15].shares;
    assert.equal(text(el.groups.whale.percent), `${((whaleShares / rows[17].shares) * 100).toFixed(2)}%`);
});

test("「查無此資料」與尚未查詢的頁面顯示對應提示，並隱藏無作用的底部按鈕", async (t) => {
    const noData = await setup(t, readFixture("tdcc-no-data.html"));
    assert.equal(text(noData.el.subtitle), "2330 · 查無資料");
    assert.match(text(noData.el.notice), /查無股權分散資料/);
    assert.equal(noData.el.results.hidden, true);
    assert.equal(noData.el.footer.hidden, true);
    assert.equal(noData.el.copyButton.disabled, true);
    assert.equal(noData.app.getDistribution(), null);

    const withCode = await setup(t, readFixture("tdcc-no-data-9999999.html"));
    assert.equal(text(withCode.el.subtitle), "9999999 · 查無資料");

    const initial = await setup(t, readFixture("tdcc-initial.html"));
    assert.equal(text(initial.el.subtitle), "請輸入證券代號查詢");
    assert.match(text(initial.el.notice), /輸入證券代號並按「查詢」/);
    assert.equal(initial.el.results.hidden, true);
    assert.equal(initial.el.footer.hidden, true);
});

test("沒有差異數調整列的真實頁面 (0050)：三族群加總剛好 100%", async (t) => {
    const { el, app } = await setup(t, readFixture("tdcc-0050-20261030.html"));
    const result = app.getDistribution();

    assert.equal(text(el.subtitle), "0050 元大台灣50 · 115年10月30日");
    assert.equal(result.totalShares, 23267000000);
    assert.ok(Math.abs(result.whale.percent + result.middle.percent + result.retail.percent - 100) < 1e-9);
    assert.equal(el.notice.hidden, true);
});

test("只解析到部分級距時顯示不完整警告", async (t) => {
    const rows = {
        1: { holders: 10, shares: 500, percent: 5 },
        15: { holders: 1, shares: 9500, percent: 95 },
        17: { holders: 11, shares: 10000, percent: 100 },
    };
    const { el } = await setup(t, buildTdccPage({ stockNo: "9999", stockName: "測試", dataDate: "115年10月22日", rows }));

    assert.equal(el.notice.hidden, false);
    assert.match(text(el.notice), /僅解析到 2\/15 個級距/);
});

test("差異數調整明顯時 (例如 00406A) 說明比例加總不等於 100%", async (t) => {
    const { date, rows } = SAMPLE.get("00406A");
    const { el } = await setup(t, buildTdccPage({ stockNo: "00406A", stockName: "測試 ETF", dataDate: date, rows }));

    assert.equal(el.notice.hidden, false);
    assert.ok(el.notice.classList.contains("is-warning"));
    assert.match(text(el.notice), /差異數調整」為 -0\.50%/);
    assert.match(text(el.notice), /三族群加總為 100\.50%/);
});

test("級距明細依族群標示、逐列顯示 TDCC 原始比例，底部族群合計與卡片一致", async (t) => {
    const { el, window, store } = await setup(t);
    const classes = () => el.levelRows.map((row) => row.row.className);

    assert.deepEqual(classes(), [...Array(9).fill("retail"), ...Array(5).fill("middle"), "whale"]);
    assert.equal(text(el.levelRows[0].holders), "2,594,858");
    // 逐列為 TDCC 公告值 (無條件捨去)，與頁面上的表格一致
    assert.deepEqual(el.levelRows.map((row) => text(row.percent)), [
        "1.17%", "3.44%", "1.49%", "0.84%", "0.56%", "0.75%", "0.49%", "0.35%",
        "1.11%", "1.12%", "1.44%", "1.08%", "0.90%", "0.76%", "84.42%",
    ]);

    // 底部族群合計 = 卡片數值 (依股數精算)
    for (const key of ["whale", "middle", "retail"]) {
        assert.equal(text(el.groupTotalRows[key].percent), text(el.groups[key].percent), key);
    }
    assert.equal(text(el.groupTotalRows.retail.range), "1–9 級");
    assert.equal(text(el.groupTotalRows.whale.range), "15 級");
    assert.equal(text(el.groupTotalRows.retail.holders), "3,160,682");
    assert.match(text(el.root.querySelector(".table-note")), /無條件捨去/);

    change(window, el.whaleSelect, 12);
    assert.deepEqual(classes(), [...Array(9).fill("retail"), ...Array(2).fill("middle"), ...Array(4).fill("whale")]);
    assert.equal(text(el.groupTotalRows.whale.range), "12–15 級");

    change(window, el.retailSelect, 11);
    assert.equal(el.groupTotalRows.middle.row.hidden, true, "沒有中實戶時隱藏中實戶合計列");

    el.details.open = true;
    el.details.dispatchEvent(new window.Event("toggle"));
    await delay(0);
    assert.equal(store.data.showDetails, true);
});

test("複製結果：產生文字摘要並寫入剪貼簿", async (t) => {
    const copied = [];
    const { el, app } = await setup(t, undefined, { clipboard: async (value) => copied.push(value) });

    el.copyButton.click();
    await delay(0);

    assert.equal(copied.length, 1);
    assert.equal(copied[0], app.getSummaryText());
    assert.deepEqual(copied[0].split("\n"), [
        "TDCC 集保股權分散｜2330 台積電｜資料日期 115年10月22日",
        "大戶（> 1,000 張）：84.42%｜1,476 人",
        "中實戶（> 100 ~ ≤ 1,000 張）：5.33%｜4,551 人",
        "散戶（≤ 100 張）：10.24%｜3,160,682 人",
        "總股東 3,166,709 人｜依股數計算",
    ]);
    assert.equal(text(el.copyButton), "已複製 ✓");

    // 剪貼簿失敗時顯示錯誤提示，不拋出例外
    const failing = await setup(t, undefined, { clipboard: async () => Promise.reject(new Error("denied")) });
    failing.el.copyButton.click();
    await delay(0);
    assert.equal(text(failing.el.copyButton), "複製失敗");
});

test("拖曳標題列移動面板並保存位置；拖曳後不觸發收合", async (t) => {
    const { el, window, app, store } = await setup(t);

    pointer(window, el.header, "pointerdown", { pointerId: 7, clientX: 900, clientY: 100 });
    pointer(window, el.header, "pointermove", { pointerId: 7, clientX: 902, clientY: 101 }); // 未超過門檻
    assert.equal(el.panel.style.left, "", "微小移動不視為拖曳");

    pointer(window, el.header, "pointermove", { pointerId: 7, clientX: 700, clientY: 300 });
    assert.ok(el.panel.classList.contains("is-dragging"));
    pointer(window, el.header, "pointerup", { pointerId: 7, clientX: 700, clientY: 300 });
    el.header.click(); // 拖曳結束後瀏覽器會送出 click

    assert.equal(app.getSettings().collapsed, false, "拖曳後的 click 不應收合面板");
    assert.ok(!el.panel.classList.contains("is-dragging"));
    // jsdom 的 getBoundingClientRect 為 0，因此位置 = (0 - 200, 0 + 200) 夾在視窗內
    assert.deepEqual(app.getSettings().position, { left: 8, top: 200 });
    assert.equal(el.panel.style.left, "8px");
    assert.equal(el.panel.style.top, "200px");
    assert.equal(el.panel.style.right, "auto");
    await delay(0);
    assert.deepEqual(store.data.position, { left: 8, top: 200 });

    // 下一次正常點擊仍可收合
    await delay(5);
    el.header.click();
    assert.equal(app.getSettings().collapsed, true);
});

test("保存的位置超出視窗時會被夾回可見範圍", async (t) => {
    const store = createMemoryStore({ position: { left: 99999, top: -50 } });
    const { el, window } = await setup(t, undefined, { store });

    assert.equal(el.panel.style.left, `${window.innerWidth - 320 - 8}px`);
    assert.equal(el.panel.style.top, "8px");
});

test("跨分頁同步：收到其他分頁的設定變更時立即套用", async (t) => {
    let listener;
    let unsubscribed = false;
    const { el, app } = await setup(t, undefined, {
        subscribe: (fn) => {
            listener = fn;
            return () => {
                unsubscribed = true;
            };
        },
    });

    listener({ retailLevel: 3, whaleLevel: 12, collapsed: false, showDetails: false, position: null });
    assert.equal(el.retailSelect.value, "3");
    assert.equal(el.whaleSelect.value, "12");
    assert.equal(text(el.groups.retail.range), "≤ 10 張");

    const renders = app.getRenderCount();
    listener({ retailLevel: 3, whaleLevel: 12, collapsed: false, showDetails: false, position: null });
    assert.equal(app.getRenderCount(), renders, "相同設定不重繪");

    app.destroy();
    assert.equal(unsubscribed, true);
});

test("重新注入時舊實例自動釋放，頁面只保留一個面板", async (t) => {
    const first = await setup(t);
    const second = mountApp({ doc: first.doc, store: createMemoryStore(), debounceMs: DEBOUNCE });
    await second.ready;
    t.after(() => second.destroy());
    await delay(0);

    assert.equal(first.doc.querySelectorAll(`#${HOST_ID}`).length, 1);
    assert.equal(first.el.host.isConnected, false);

    const firstRenders = first.app.getRenderCount();
    first.doc.querySelector("main").insertAdjacentHTML("beforeend", "<p>changed</p>");
    first.app.refresh(true);
    await delay(DEBOUNCE * 4);
    assert.equal(first.app.getRenderCount(), firstRenders, "已釋放的實例不應再渲染");
    assert.equal(text(second.elements.groups.whale.percent), "84.42%");
});

test("面板被頁面腳本移除時自動掛回；destroy 後完全移除", async (t) => {
    const { doc, app, el } = await setup(t);

    doc.getElementById(HOST_ID).remove();
    await delay(0);
    assert.equal(el.host.isConnected, true);

    app.destroy();
    assert.equal(doc.getElementById(HOST_ID), null);

    const renders = app.getRenderCount();
    doc.body.appendChild(doc.createElement("div"));
    await delay(DEBOUNCE * 4);
    assert.equal(app.getRenderCount(), renders);
});

test("頁面沒有 body 或 window 時不掛載", () => {
    const dom = createDom("<!DOCTYPE html><html></html>");
    dom.window.document.body.remove();
    assert.equal(mountApp({ doc: dom.window.document }), null);
    dom.window.close();
});

test("資料未變時 refresh(true) 不會在 Shadow DOM 產生任何變動", async (t) => {
    const { app, el, window } = await setup(t);
    const records = [];
    const observer = new window.MutationObserver((list) => records.push(...list));
    observer.observe(el.root, { subtree: true, childList: true, characterData: true, attributes: true });

    app.refresh(true);
    await delay(0);
    observer.disconnect();

    assert.equal(records.length, 0, records.map((r) => `${r.type} ${r.target.nodeName}`).join(", "));
});

test("去抖動：分批到達的 DOM 變動只觸發一次解析", async (t) => {
    const { doc, window } = await setup(t, undefined, { debounceMs: 250 });
    let tableQueries = 0;
    const original = window.Document.prototype.querySelectorAll;
    window.Document.prototype.querySelectorAll = function (selector) {
        if (selector === "table") {
            tableQueries += 1;
        }
        return original.call(this, selector);
    };
    t.after(() => {
        window.Document.prototype.querySelectorAll = original;
    });

    doc.body.appendChild(doc.createElement("div"));
    await delay(10);
    doc.body.appendChild(doc.createElement("div"));
    await waitFor(() => tableQueries >= 1);
    await delay(400);
    assert.equal(tableQueries, 1);
});

test("頁面持續變動時，最長等待時間到仍會重新解析 (避免去抖動被餓死)", async (t) => {
    const { doc, el, window } = await setup(t, undefined, { debounceMs: 60, maxWaitMs: 200 });
    const ticker = doc.createElement("span");
    doc.body.appendChild(ticker);
    let tick = 0;
    const interval = window.setInterval(() => {
        ticker.textContent = String((tick += 1));
    }, 20);
    t.after(() => window.clearInterval(interval));
    // 前置條件：計時器已開始持續變動頁面
    await waitFor(() => tick >= 3);

    const { date, rows } = SAMPLE.get("2317");
    doc.querySelector("main").innerHTML = buildTdccPage({ stockNo: "2317", stockName: "鴻海", dataDate: date, rows })
        .replace(/^[\s\S]*<main role="main">|<\/main>[\s\S]*$/g, "");

    // 計時器每 20ms 變動一次頁面，若沒有最長等待時間，去抖動永遠不會觸發；以輪詢等待避免 CI 不穩定
    // 若沒有最長等待時間，計時器每 20ms 的變動會讓去抖動一直延後，以下等待將逾時失敗
    await waitFor(() => text(el.subtitle) === `2317 鴻海 · ${date}`, { timeout: 2000 });
});

test("跨分頁同步：忽略本分頁自己寫入的回音，不會把較新的變更蓋回舊值", async (t) => {
    let listener;
    const { el, window, app } = await setup(t, undefined, {
        subscribe: (fn) => {
            listener = fn;
            return () => {};
        },
    });

    change(window, el.whaleSelect, 12); // 寫入 A：{ retail 9, whale 12 }
    change(window, el.retailSelect, 8); // 寫入 B：{ retail 8, whale 12 }
    const echo = { collapsed: false, showDetails: false, position: null };

    listener({ ...echo, retailLevel: 9, whaleLevel: 12 }); // A 的回音較晚到達
    assert.equal(el.retailSelect.value, "8", "舊回音不可覆蓋較新的本地變更");
    assert.deepEqual([app.getSettings().retailLevel, app.getSettings().whaleLevel], [8, 12]);

    listener({ ...echo, retailLevel: 8, whaleLevel: 12 }); // B 的回音
    assert.equal(el.retailSelect.value, "8");

    // 其他分頁真正的變更仍會套用
    listener({ ...echo, retailLevel: 3, whaleLevel: 10 });
    assert.equal(el.retailSelect.value, "3");
    assert.equal(el.whaleSelect.value, "10");
});

test("跨分頁同步：設定讀取完成前收到的較新設定不會被較舊的讀取結果覆蓋", async (t) => {
    const dom = createDom(readFixture("tdcc-2330-20261022.html"));
    let listener;
    const slowStore = {
        load: () => new Promise((resolve) => setTimeout(() => resolve({ retailLevel: 9, whaleLevel: 15 }), 40)),
        save: async () => {},
    };
    const app = mountApp({
        doc: dom.window.document,
        store: slowStore,
        debounceMs: DEBOUNCE,
        subscribe: (fn) => {
            listener = fn;
            return () => {};
        },
    });
    t.after(() => {
        app.destroy();
        dom.window.close();
    });

    listener({ retailLevel: 3, whaleLevel: 12, collapsed: false, showDetails: false, position: null });
    await app.ready;

    assert.deepEqual([app.getSettings().retailLevel, app.getSettings().whaleLevel], [3, 12]);
    assert.equal(app.elements.whaleSelect.value, "12");
});

test("設定讀取逾時時仍以預設值顯示面板", async (t) => {
    const dom = createDom(readFixture("tdcc-2330-20261022.html"));
    const app = mountApp({
        doc: dom.window.document,
        store: { load: () => new Promise(() => {}), save: async () => {} },
        debounceMs: DEBOUNCE,
        loadTimeoutMs: 50,
    });
    t.after(() => {
        app.destroy();
        dom.window.close();
    });

    assert.equal(app.elements.panel.style.visibility, "hidden");
    await waitFor(() => app.elements.panel.style.visibility === "");
    assert.equal(text(app.elements.groups.whale.percent), "84.42%");
});

test("設定在逾時顯示後才讀取完成時，不覆蓋使用者在這段期間的調整", async (t) => {
    const dom = createDom(readFixture("tdcc-2330-20261022.html"));
    let resolveLoad;
    const app = mountApp({
        doc: dom.window.document,
        store: { load: () => new Promise((resolve) => (resolveLoad = resolve)), save: async () => {} },
        debounceMs: DEBOUNCE,
        loadTimeoutMs: 30,
    });
    t.after(() => {
        app.destroy();
        dom.window.close();
    });

    await waitFor(() => app.elements.panel.style.visibility === "");
    change(dom.window, app.elements.whaleSelect, 12);
    resolveLoad({ retailLevel: 9, whaleLevel: 15 });
    await app.ready;

    assert.equal(app.getSettings().whaleLevel, 12);
    assert.equal(app.elements.whaleSelect.value, "12");
});

test("面板貼近底部時展開會往上移，確保內容可見；位置夾住範圍不含捲軸", async (t) => {
    const store = createMemoryStore({ collapsed: true, position: { left: 99999, top: 700 } });
    const dom = createDom(readFixture("tdcc-2330-20261022.html"));
    const doc = dom.window.document;
    // 模擬實際版面：視窗 1024×768，垂直捲軸寬 15px
    Object.defineProperty(doc.documentElement, "clientWidth", { configurable: true, value: 1009 });
    Object.defineProperty(doc.documentElement, "clientHeight", { configurable: true, value: 768 });
    const app = mountApp({ doc, store, debounceMs: DEBOUNCE });
    await app.ready;
    t.after(() => {
        app.destroy();
        dom.window.close();
    });

    const el = app.elements;
    let bodyHeight = 400;
    Object.defineProperty(el.header, "offsetHeight", { configurable: true, value: 56 });
    Object.defineProperty(el.body, "scrollHeight", { configurable: true, get: () => bodyHeight });
    // 面板上下邊框各 1px
    Object.defineProperty(el.panel, "offsetHeight", { configurable: true, value: 460 });
    Object.defineProperty(el.panel, "clientHeight", { configurable: true, value: 458 });

    assert.equal(el.panel.style.left, `${1009 - 320 - 8}px`, "不可被捲軸遮住");
    assert.equal(el.panel.style.top, "700px", "收合時只需標題列可見");

    el.toggleButton.click();
    assert.equal(app.getSettings().collapsed, false);
    const expandedTop = 768 - (56 + 2 + 400) - 8;
    assert.equal(el.panel.style.top, `${expandedTop}px`, "展開後應上移以顯示完整內容 (含邊框)");
    assert.equal(el.panel.style.maxHeight, `calc(100vh - ${expandedTop + 8}px)`);
    // 使用者保存的位置不因暫時夾住而改變
    assert.deepEqual(app.getSettings().position, { left: 99999, top: 700 });

    // 內容很高 (例如展開級距明細) 時，面板最多上移到預設位置，其餘於面板內捲動，不會蓋住 TDCC 主選單
    bodyHeight = 900;
    el.details.open = true;
    el.details.dispatchEvent(new dom.window.Event("toggle"));
    assert.equal(el.panel.style.top, `${CONFIG.defaultTopPx}px`);
});

test("頁面載入時，保存的位置依「結果繪製後」的實際高度夾住", async (t) => {
    const store = createMemoryStore({ collapsed: false, position: { left: 0, top: 9999 } });
    const dom = createDom(readFixture("tdcc-2330-20261022.html"));
    const app = mountApp({ doc: dom.window.document, store, debounceMs: DEBOUNCE });
    const el = app.elements;
    Object.defineProperty(el.header, "offsetHeight", { configurable: true, value: 56 });
    // 結果區塊顯示前內容只有選單 (80px)，顯示後為 380px
    Object.defineProperty(el.body, "scrollHeight", { configurable: true, get: () => (el.results.hidden ? 80 : 380) });
    await app.ready;
    t.after(() => {
        app.destroy();
        dom.window.close();
    });

    assert.equal(el.results.hidden, false);
    assert.equal(el.panel.style.top, `${768 - (56 + 380) - 8}px`);
});

test("位置夾住範圍以 clientHeight 為準 (水平捲軸出現時不被遮住)", async (t) => {
    const store = createMemoryStore({ collapsed: true, position: { left: 0, top: 9999 } });
    const dom = createDom(readFixture("tdcc-2330-20261022.html"));
    const doc = dom.window.document;
    assert.equal(dom.window.innerHeight, 768);
    Object.defineProperty(doc.documentElement, "clientHeight", { configurable: true, value: 753 });
    const app = mountApp({ doc, store, debounceMs: DEBOUNCE });
    await app.ready;
    t.after(() => {
        app.destroy();
        dom.window.close();
    });

    // jsdom 無版面：標題列高度退回 48 → 收合時 top 上限 = 753 - 48 - 8
    assert.equal(app.elements.panel.style.top, `${753 - 48 - 8}px`);
});

test("剪貼簿在面板移除後才完成時不會出錯", async (t) => {
    const { el, app } = await setup(t, undefined, { clipboard: () => new Promise((resolve) => setTimeout(resolve, 20)) });

    el.copyButton.click();
    app.destroy();
    await delay(50);
    assert.equal(text(el.copyButton), "複製結果");
});

test("樣式：列印時隱藏面板，並支援減少動態效果", async (t) => {
    const { el } = await setup(t);
    const css = el.root.querySelector("style").textContent;

    assert.match(css, /@media print\s*{\s*\.panel\s*{\s*display:\s*none !important;/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /z-index:\s*990;/);
});

test("資料由有變無時 (頁面換成「查無此資料」) 隱藏結果與底部列", async (t) => {
    const { doc, el } = await setup(t);
    assert.equal(el.footer.hidden, false);

    doc.querySelector("main").innerHTML = readFixture("tdcc-no-data.html")
        .replace(/^[\s\S]*<main role="main">|<\/main>[\s\S]*$/g, "");
    await waitFor(() => el.results.hidden);

    assert.equal(text(el.subtitle), "2330 · 查無資料");
    assert.equal(el.footer.hidden, true, "沒有資料時不顯示「總股東 N 人」底部列");
    assert.equal(el.copyButton.disabled, true);
});

test("收合時標題以縮寫日期顯示證券資訊，完整資訊放在 title 屬性", async (t) => {
    const { el } = await setup(t, readFixture("tdcc-0050-20261030.html"));

    el.header.click();
    assert.equal(text(el.title), "0050 元大台灣50 · 115/10/30");
    assert.equal(el.title.title, "0050 元大台灣50 · 115年10月30日");

    el.header.click();
    assert.equal(text(el.title), "持股比例統計");
});

test("沒有資料時調整門檻，衝突提示仍會播報給螢幕閱讀器", async (t) => {
    const { el, window } = await setup(t, readFixture("tdcc-initial.html"));

    change(window, el.whaleSelect, 9);
    await waitFor(() => text(el.live) !== "");
    assert.equal(text(el.live), "散戶門檻暫時調整為「≤ 50 張」以避免與大戶重疊，大戶門檻調回後自動還原。");
});

test("門檻自動調整提示在 hintDurationMs 後自動隱藏", async (t) => {
    const { el, window } = await setup(t);
    // 只把提示計時縮短為 30ms，避免測試等待 4 秒
    const originalSetTimeout = window.setTimeout;
    window.setTimeout = (handler, ms, ...args) =>
        originalSetTimeout.call(window, handler, ms === CONFIG.hintDurationMs ? 30 : ms, ...args);
    t.after(() => {
        window.setTimeout = originalSetTimeout;
    });

    change(window, el.whaleSelect, 9);
    assert.equal(el.hint.hidden, false);
    await waitFor(() => el.hint.hidden, { timeout: 1000 });
});

test("去抖動：第一次解析後重新計時，之後分批到達的變動仍只觸發一次解析", async (t) => {
    const { doc, window } = await setup(t, undefined, { debounceMs: 250, maxWaitMs: 300 });
    let tableQueries = 0;
    const original = window.Document.prototype.querySelectorAll;
    window.Document.prototype.querySelectorAll = function (selector) {
        if (selector === "table") {
            tableQueries += 1;
        }
        return original.call(this, selector);
    };
    t.after(() => {
        window.Document.prototype.querySelectorAll = original;
    });

    doc.body.appendChild(doc.createElement("div"));
    await waitFor(() => tableQueries === 1);
    await delay(350); // 超過 maxWaitMs

    doc.body.appendChild(doc.createElement("div"));
    await delay(30);
    doc.body.appendChild(doc.createElement("div"));
    await waitFor(() => tableQueries >= 2);
    await delay(400);
    assert.equal(tableQueries, 2, "第二批的兩次變動應合併為一次解析 (不可沿用舊的等待起點而立即解析)");
});

/** 模擬 chrome.storage：onChanged 依寫入順序非同步送達，相同值寫入不發出事件 */
function createFakeSyncedStorage() {
    let stored;
    const listeners = new Set();
    const queue = [];
    const flush = () => {
        while (queue.length) {
            const value = queue.shift();
            listeners.forEach((fn) => fn(value));
        }
    };
    return {
        store: {
            load: async () => stored,
            save: async (value) => {
                if (JSON.stringify(value) === JSON.stringify(stored)) {
                    return; // chrome.storage 對相同值不發出 onChanged
                }
                stored = structuredClone(value);
                queue.push(structuredClone(value));
            },
        },
        subscribe: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
        /** 模擬其他分頁寫入 (在佇列中的時間點即為寫入順序) */
        externalWrite(value) {
            stored = structuredClone(value);
            queue.push(structuredClone(value));
        },
        flush,
        get stored() {
            return stored;
        },
    };
}

test("跨分頁同步：其他分頁的較早寫入若在本分頁寫入之前送達，不會覆蓋本分頁較新的設定", async (t) => {
    const storage = createFakeSyncedStorage();
    const { el, window } = await setup(t, undefined, { store: storage.store, subscribe: storage.subscribe });
    const base = { collapsed: false, showDetails: false, position: null };

    storage.externalWrite({ ...base, retailLevel: 3, whaleLevel: 10 }); // 其他分頁先寫入 W
    change(window, el.whaleSelect, 12); // 本分頁接著寫入 Z (儲存的最終值)
    await delay(0);
    storage.flush(); // 依序送達：W、Z 的回音

    assert.equal(el.whaleSelect.value, "12");
    assert.equal(el.retailSelect.value, "9");
    assert.equal(storage.stored.whaleLevel, 12, "儲存空間最終為本分頁的寫入");
});

test("跨分頁同步：寫入與儲存值相同時不留下殘留紀錄，之後其他分頁的變更仍會套用", async (t) => {
    const storage = createFakeSyncedStorage();
    const { el, window } = await setup(t, undefined, { store: storage.store, subscribe: storage.subscribe });
    const base = { collapsed: false, showDetails: false, position: null };

    change(window, el.whaleSelect, 12);
    await delay(0);
    storage.flush();
    change(window, el.whaleSelect, 12); // 相同值：不寫入、也不應等待回音
    await delay(0);
    storage.flush();

    storage.externalWrite({ ...base, retailLevel: 9, whaleLevel: 15 });
    storage.flush();
    assert.equal(el.whaleSelect.value, "15", "其他分頁的變更必須套用");
});

test("跨分頁同步：自己的回音只忽略一次，之後其他分頁設成相同值仍會套用", async (t) => {
    let listener;
    const { el, window } = await setup(t, undefined, {
        subscribe: (fn) => {
            listener = fn;
            return () => {};
        },
    });
    const rest = { collapsed: false, showDetails: false, position: null };

    change(window, el.whaleSelect, 12); // 寫入 { retail 9, whale 12 }
    listener({ ...rest, retailLevel: 9, whaleLevel: 12 }); // 回音：忽略
    change(window, el.retailSelect, 8); // 寫入 { retail 8, whale 12 }
    listener({ ...rest, retailLevel: 8, whaleLevel: 12 }); // 回音：忽略

    // 其他分頁把散戶改回 ≤ 100 張：內容恰好與先前已消耗的回音相同，但仍必須套用
    listener({ ...rest, retailLevel: 9, whaleLevel: 12 });
    assert.equal(el.retailSelect.value, "9");
});

test("跨分頁同步：寫入失敗時移除等待中的回音紀錄", async (t) => {
    let listener;
    const failingStore = { load: async () => undefined, save: async () => Promise.reject(new Error("quota")) };
    const { el, window } = await setup(t, undefined, {
        store: failingStore,
        subscribe: (fn) => {
            listener = fn;
            return () => {};
        },
    });

    change(window, el.whaleSelect, 12);
    await delay(0);
    listener({ retailLevel: 3, whaleLevel: 10, collapsed: false, showDetails: false, position: null });
    assert.equal(el.whaleSelect.value, "10");
});
