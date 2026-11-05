/**
 * 以 TDCC 開放資料 (股權分散表 CSV) 進行全組合正確性驗證：
 * 對每一檔證券產生與 TDCC 實際頁面相同結構的 HTML → 解析 → 計算，
 * 並與獨立的參考計算比對所有 105 種 (散戶, 大戶) 門檻組合。
 *
 * 預設使用 tests/fixtures/tdcc-opendata-sample.csv (分層抽樣 67 檔)；
 * 設定環境變數 TDCC_OPENDATA_CSV=<完整 CSV 路徑> 可驗證全市場 (約 4,000 檔)：
 * https://opendata.tdcc.com.tw/getOD.ashx?id=1-5
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { calculateDistribution } from "../dist-test/core/calculator.js";
import { parseStockPage } from "../dist-test/core/parser.js";
import {
    buildTdccPage,
    createDom,
    FIXTURE_DIR,
    parseOpenDataCsv,
    referenceDistribution,
    signedAdjustment,
    tdccTruncatedPercentHundredths,
} from "./helpers/tdcc.mjs";

const csvPath = process.env.TDCC_OPENDATA_CSV || path.join(FIXTURE_DIR, "tdcc-opendata-sample.csv");
const securities = parseOpenDataCsv(fs.readFileSync(csvPath, "utf8"));
const TOLERANCE = 1e-9;

test(`開放資料全組合驗證 (${securities.size} 檔證券 × 105 種門檻組合)`, () => {
    const dom = createDom("<!DOCTYPE html><html><body></body></html>");
    const doc = dom.window.document;
    let comparisons = 0;
    let maxLegacyError = 0;

    for (const [code, { date, rows }] of securities) {
        doc.body.innerHTML = buildTdccPage({ stockNo: code, stockName: `測試${code}`, dataDate: date, rows })
            .replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, "");

        const parsed = parseStockPage(doc);
        assert.equal(parsed.status, "ok", code);
        assert.equal(parsed.levels.length, 15, code);
        assert.deepEqual(parsed.warnings, [], code);
        assert.equal(parsed.meta.stockNo, code);
        assert.equal(parsed.total.shares, rows[17].shares, code);

        // CSV 的差異數調整為絕對值：|1~15 級股數 - 合計| 必須等於 CSV 差異數調整股數
        assert.equal(Math.abs(signedAdjustment(rows)), rows[16].shares, `${code} 差異數調整不一致`);

        // 合計股數 = 1~15 級股數 + 差異數調整 (帶正負號，與網頁一致)
        const levelShares = parsed.levels.reduce((sum, item) => sum + item.shares, 0);
        assert.equal(levelShares + (parsed.adjustment?.shares ?? 0), parsed.total.shares, `${code} 股數不平衡`);

        // 確認分母選擇與 TDCC 一致：TDCC 比例欄 = floor(股數 ÷ 合計股數 × 10000) / 100 (無條件捨去)
        for (const item of parsed.levels) {
            assert.equal(
                Math.round(item.percent * 100),
                tdccTruncatedPercentHundredths(item.shares, parsed.total.shares),
                `${code} 第 ${item.level} 級比例 ${item.percent}`,
            );
        }

        for (let whale = 2; whale <= 15; whale += 1) {
            for (let retail = 1; retail < whale; retail += 1) {
                const actual = calculateDistribution(parsed, retail, whale);
                const expected = referenceDistribution(rows, retail, whale);
                const label = `${code} 散戶≤${retail} 大戶≥${whale}`;

                assert.equal(actual.method, "shares", label);
                assert.equal(actual.retailLevel, retail, label);
                assert.equal(actual.whaleLevel, whale, label);
                assert.equal(actual.totalHolders, expected.totalHolders, label);

                for (const key of ["retail", "middle", "whale"]) {
                    assert.equal(actual[key].holders, expected[key].holders, `${label} ${key} 人數`);
                    assert.equal(actual[key].shares, expected[key].shares, `${label} ${key} 股數`);
                    assert.ok(Math.abs(actual[key].percent - expected[key].percent) <= TOLERANCE, `${label} ${key} 比例 ${actual[key].percent} vs ${expected[key].percent}`);
                }

                // 三族群人數互斥且完整
                assert.equal(actual.retail.holders + actual.middle.holders + actual.whale.holders, expected.totalHolders, label);

                // 舊方法 (加總 TDCC 已無條件捨去的比例欄) 必定低估，且每個級距最多少 0.01 個百分點
                for (const [key, from, to] of [["retail", 1, retail], ["whale", whale, 15]]) {
                    let legacy = 0;
                    for (let level = from; level <= to; level += 1) {
                        legacy += rows[level].percent;
                    }
                    const error = expected[key].percent - legacy;
                    assert.ok(error > -1e-9, `${label} ${key} 舊方法不應高估 (${legacy} vs ${expected[key].percent})`);
                    assert.ok(error < 0.01 * (to - from + 1) + 1e-9, `${label} ${key} 舊方法誤差超出理論上限`);
                    maxLegacyError = Math.max(maxLegacyError, error);
                }
                comparisons += 1;
            }
        }
    }

    assert.equal(comparisons, securities.size * 105);
    // 舊方法在抽樣資料中確實存在可觀誤差 (> 0.05 個百分點)，新方法誤差為 0
    assert.ok(maxLegacyError > 0.05, `legacy max error ${maxLegacyError}`);
    dom.window.close();
});
