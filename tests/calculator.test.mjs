import assert from "node:assert/strict";
import test from "node:test";
import { calculateDistribution, normalizeThresholds } from "../dist-test/core/calculator.js";
import { parseStockPage } from "../dist-test/core/parser.js";
import { createDom, readFixture } from "./helpers/tdcc.mjs";

const close = (actual, expected, tolerance = 1e-9, message) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `expected ${expected}, got ${actual}`);

const real2330 = () => parseStockPage(createDom(readFixture("tdcc-2330-20261022.html")).window.document);

test("normalizeThresholds: 保證 1 <= 散戶 < 大戶 <= 15", () => {
    assert.deepEqual(normalizeThresholds(9, 15), { retailLevel: 9, whaleLevel: 15 });
    // 超出範圍時夾住
    assert.deepEqual(normalizeThresholds(-3, 99), { retailLevel: 1, whaleLevel: 15 });
    assert.deepEqual(normalizeThresholds(15, 1), { retailLevel: 1, whaleLevel: 2 });
    // 小數截斷
    assert.deepEqual(normalizeThresholds(8.9, 12.2), { retailLevel: 8, whaleLevel: 12 });
    // NaN 使用預設值
    assert.deepEqual(normalizeThresholds(Number.NaN, Number.NaN), { retailLevel: 9, whaleLevel: 15 });
    // 衝突時預設保留大戶門檻
    assert.deepEqual(normalizeThresholds(12, 12), { retailLevel: 11, whaleLevel: 12 });
    assert.deepEqual(normalizeThresholds(13, 10), { retailLevel: 9, whaleLevel: 10 });
    // 衝突時保留散戶門檻
    assert.deepEqual(normalizeThresholds(12, 12, "retail"), { retailLevel: 12, whaleLevel: 13 });
    assert.deepEqual(normalizeThresholds(14, 3, "retail"), { retailLevel: 14, whaleLevel: 15 });
});

test("calculateDistribution: 真實 2330 資料依股數精算 (散戶 ≤100 張、大戶 >1,000 張)", () => {
    const parsed = real2330();
    const result = calculateDistribution(parsed, 9, 15);
    const totalShares = 25932370067;

    assert.equal(result.method, "shares");
    assert.equal(result.totalShares, totalShares);
    assert.equal(result.totalHolders, 3166709);
    assert.equal(result.levelCount, 15);

    // 散戶：第 1~9 級
    assert.deepEqual(result.retail.range, [1, 9]);
    assert.equal(result.retail.shares, 2656698182);
    assert.equal(result.retail.holders, 3160682);
    close(result.retail.percent, (2656698182 / totalShares) * 100);
    assert.equal(result.retail.percent.toFixed(2), "10.24");

    // 中實戶：第 10~14 級
    assert.deepEqual(result.middle.range, [10, 14]);
    assert.equal(result.middle.shares, 1382595061);
    assert.equal(result.middle.holders, 4551);
    assert.equal(result.middle.percent.toFixed(2), "5.33");

    // 大戶：第 15 級
    assert.deepEqual(result.whale.range, [15, 15]);
    assert.equal(result.whale.shares, 21893080824);
    assert.equal(result.whale.holders, 1476);
    assert.equal(result.whale.percent.toFixed(2), "84.42");
    close(result.whale.holderRatio, (1476 / 3166709) * 100);

    // 三族群股數 + 差異數調整 = 合計；比例總和 = 100% - 差異數調整比例
    assert.equal(result.retail.shares + result.middle.shares + result.whale.shares + parsed.adjustment.shares, totalShares);
    close(result.retail.percent + result.middle.percent + result.whale.percent, 100 + (4000 / totalShares) * 100, 1e-9);
    assert.equal(result.retail.holders + result.middle.holders + result.whale.holders, result.totalHolders);
});

test("calculateDistribution: 修正前的方法 (加總 TDCC 無條件捨去的比例欄) 會低估 2330 散戶 0.04 個百分點", () => {
    const parsed = real2330();
    const legacyRetail = parsed.levels.filter((item) => item.level <= 9).reduce((sum, item) => sum + item.percent, 0);
    const exact = calculateDistribution(parsed, 9, 15).retail.percent;

    assert.equal(legacyRetail.toFixed(2), "10.20");
    assert.equal(exact.toFixed(2), "10.24");
});

test("calculateDistribution: 大戶門檻選第 12 級時只包含 12~15 級 (400 張以上)，不含第 11 級", () => {
    const parsed = real2330();
    const result = calculateDistribution(parsed, 9, 12);
    const expectedShares = parsed.levels.filter((item) => item.level >= 12).reduce((sum, item) => sum + item.shares, 0);

    assert.deepEqual(result.whale.range, [12, 15]);
    assert.equal(result.whale.shares, expectedShares);
    assert.equal(result.whale.holders, 576 + 339 + 222 + 1476);
    assert.deepEqual(result.middle.range, [10, 11]);
});

test("calculateDistribution: 兩門檻相鄰時中實戶為空", () => {
    const result = calculateDistribution(real2330(), 14, 15);

    assert.equal(result.middle.range, null);
    assert.equal(result.middle.percent, 0);
    assert.equal(result.middle.holders, 0);
    assert.deepEqual(result.retail.range, [1, 14]);
});

test("calculateDistribution: 門檻重疊時自動正規化，不會重複計算", () => {
    const parsed = real2330();
    const result = calculateDistribution(parsed, 15, 9);

    assert.ok(result.retailLevel < result.whaleLevel);
    close(result.retail.percent + result.middle.percent + result.whale.percent, 100 + (4000 / 25932370067) * 100, 1e-9);
});

test("calculateDistribution: 合計列缺漏時以 1~15 級股數 + 差異數調整推算分母", () => {
    const levels = [
        { level: 1, holders: 10, shares: 1000, percent: 10 },
        { level: 15, holders: 1, shares: 8000, percent: 80 },
    ];
    const result = calculateDistribution({ levels, total: null, adjustment: { holders: null, shares: 1000, percent: 10 } }, 9, 15);

    assert.equal(result.method, "shares");
    assert.equal(result.totalShares, 10000);
    close(result.retail.percent, 10);
    close(result.whale.percent, 80);
    assert.equal(result.totalHolders, 11);
});

test("calculateDistribution: 股數不完整時退回加總比例欄位", () => {
    const levels = [
        { level: 1, holders: 1000, shares: null, percent: 10 },
        { level: 9, holders: 500, shares: 50, percent: 15.5 },
        { level: 12, holders: 20, shares: 100, percent: 30.25 },
        { level: 15, holders: 5, shares: 900, percent: 20 },
    ];
    const result = calculateDistribution({ levels }, 9, 12);

    assert.equal(result.method, "percent");
    assert.equal(result.totalShares, null);
    close(result.retail.percent, 25.5);
    close(result.whale.percent, 50.25);
    assert.equal(result.retail.holders, 1500);
    assert.equal(result.whale.holders, 25);
    assert.equal(result.totalHolders, 1525);
    assert.equal(result.retail.shares, null);
});

test("calculateDistribution: 無資料時回傳 0 且不產生 NaN", () => {
    const result = calculateDistribution({ levels: [] }, 9, 15);

    assert.equal(result.method, "percent");
    assert.equal(result.totalHolders, 0);
    for (const key of ["retail", "middle", "whale"]) {
        assert.equal(result[key].percent, 0);
        assert.equal(result[key].holders, 0);
        assert.equal(result[key].holderRatio, null);
    }
});

test("calculateDistribution: 合計股數為 0 時退回比例欄位，避免除以 0", () => {
    const levels = [{ level: 1, holders: 0, shares: 0, percent: 0 }];
    const result = calculateDistribution({ levels, total: { holders: 0, shares: 0, percent: 0 } }, 9, 15);

    assert.equal(result.method, "percent");
    assert.ok(Number.isFinite(result.retail.percent));
});
