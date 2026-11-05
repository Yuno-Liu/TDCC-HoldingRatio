import assert from "node:assert/strict";
import test from "node:test";
import { LEVELS } from "../dist-test/config/constants.js";
import {
    clampPercentage,
    formatHolders,
    formatInteger,
    formatLots,
    formatPercent,
    getLevelDefinition,
    groupRangeLabel,
    groupShareRange,
    levelLotRange,
    levelShareRange,
    formatAverageLots,
    retailOptionLabel,
    retailShortLabel,
    whaleOptionLabel,
    whaleShortLabel,
} from "../dist-test/core/format.js";

test("clampPercentage: 限制於 0~100，非有限數字回傳 0", () => {
    assert.equal(clampPercentage(-5), 0);
    assert.equal(clampPercentage(42.5), 42.5);
    assert.equal(clampPercentage(120), 100);
    assert.equal(clampPercentage(Number.NaN), 0);
    assert.equal(clampPercentage(Number.POSITIVE_INFINITY), 0);
});

test("數值格式化：千分位、百分比、人數與張數", () => {
    assert.equal(formatInteger(1234567), "1,234,567");
    assert.equal(formatInteger(null), "--");
    assert.equal(formatHolders(0), "0 人");
    assert.equal(formatHolders(12345), "12,345 人");
    assert.equal(formatHolders(-1), "-- 人");
    assert.equal(formatHolders(Number.NaN), "-- 人");
    assert.equal(formatPercent(84.4249), "84.42%");
    assert.equal(formatPercent(10.2447, 1), "10.2%");
    assert.equal(formatPercent(-0.001), "0.00%");
    assert.equal(formatPercent(null), "--%");
    assert.equal(formatLots(21893080824), "21,893,081 張");
    assert.equal(formatLots(499), "0 張");
    assert.equal(formatLots(null), "-- 張");
});

test("LEVELS: 15 個級距連續且不重疊", () => {
    assert.equal(LEVELS.length, 15);
    LEVELS.forEach((definition, index) => {
        assert.equal(definition.level, index + 1);
        if (index > 0) {
            assert.equal(definition.minShares, LEVELS[index - 1].maxShares + 1, `第 ${index + 1} 級應緊接上一級`);
        }
    });
    assert.equal(LEVELS[0].minShares, 1);
    assert.equal(LEVELS[14].maxShares, null);
    assert.throws(() => getLevelDefinition(0), RangeError);
    assert.throws(() => getLevelDefinition(16), RangeError);
});

test("散戶選項以級距「上限」標示 (散戶 = 級距 ≤ 所選)", () => {
    assert.deepEqual(
        Array.from({ length: 14 }, (_, i) => retailOptionLabel(i + 1)),
        ["< 1 張 · 零股", "≤ 5 張", "≤ 10 張", "≤ 15 張", "≤ 20 張", "≤ 30 張", "≤ 40 張", "≤ 50 張", "≤ 100 張", "≤ 200 張", "≤ 400 張", "≤ 600 張", "≤ 800 張", "≤ 1,000 張"],
    );
});

test("大戶選項以級距「下限」標示 (大戶 = 級距 ≥ 所選)，修正舊版以上限標示造成的誤導", () => {
    assert.deepEqual(
        Array.from({ length: 14 }, (_, i) => whaleOptionLabel(i + 2)),
        ["≥ 1 張", "> 5 張", "> 10 張", "> 15 張", "> 20 張", "> 30 張", "> 40 張", "> 50 張", "> 100 張", "> 200 張", "> 400 張 · 400張大戶", "> 600 張", "> 800 張", "> 1,000 張 · 千張大戶"],
    );
});

test("收合摘要用的族群簡稱包含門檻定義", () => {
    assert.equal(whaleShortLabel(15), "千張大戶");
    assert.equal(whaleShortLabel(12), "400張大戶");
    assert.equal(whaleShortLabel(10), ">100張大戶");
    assert.equal(whaleShortLabel(2), "≥1張大戶");
    assert.equal(retailShortLabel(9), "≤100張散戶");
    assert.equal(retailShortLabel(1), "<1張散戶");
    assert.equal(retailShortLabel(14), "≤1,000張散戶");
});

test("formatAverageLots: 每人平均張數 (小於 10 張保留 2 位小數)", () => {
    assert.equal(formatAverageLots(2656698182, 3160682), "0.84 張");
    assert.equal(formatAverageLots(21893080824, 1476), "14,833 張");
    assert.equal(formatAverageLots(100, 0), "--");
    assert.equal(formatAverageLots(null, 5), "--");
});

test("級距與族群區間文字", () => {
    assert.equal(levelShareRange(1), "1–999 股");
    assert.equal(levelShareRange(9), "50,001–100,000 股");
    assert.equal(levelShareRange(15), "1,000,001 股以上");
    assert.equal(levelLotRange(1), "< 1");
    assert.equal(levelLotRange(2), "1–5");
    assert.equal(levelLotRange(9), "50–100");
    assert.equal(levelLotRange(15), "> 1,000");

    assert.equal(groupRangeLabel([1, 9]), "≤ 100 張");
    assert.equal(groupRangeLabel([1, 1]), "< 1 張");
    assert.equal(groupRangeLabel([15, 15]), "> 1,000 張");
    assert.equal(groupRangeLabel([12, 15]), "> 400 張");
    assert.equal(groupRangeLabel([10, 14]), "> 100 ~ ≤ 1,000 張");
    assert.equal(groupRangeLabel([2, 8]), "≥ 1 ~ ≤ 50 張");
    assert.equal(groupRangeLabel([1, 15]), "全部");
    assert.equal(groupRangeLabel(null), "無");

    assert.equal(groupShareRange([10, 14]), "100,001–1,000,000 股（第 10–14 級）");
    assert.equal(groupShareRange([15, 15]), "1,000,001 股以上（第 15 級）");
    assert.equal(groupShareRange(null), "無對應級距");
});
