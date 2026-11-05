import { CONFIG } from "../config/constants.js";
import type { Distribution, GroupTotals, ParseResult, StockLevelData } from "../types/index.js";

/**
 * 正規化散戶與大戶門檻，保證兩個族群不重疊：
 * 1 <= retailLevel < whaleLevel <= 15
 *
 * 若兩者衝突 (retailLevel >= whaleLevel)，以 `prefer` 指定的一方為準並調整另一方
 *
 * @param retailLevel - 散戶門檻 (級距 <= 此值為散戶)
 * @param whaleLevel - 大戶門檻 (級距 >= 此值為大戶)
 * @param prefer - 發生衝突時保留哪一方的設定 (預設保留大戶門檻)
 * @returns 正規化後的門檻
 */
export function normalizeThresholds(
    retailLevel: number,
    whaleLevel: number,
    prefer: "retail" | "whale" = "whale",
): { retailLevel: number; whaleLevel: number } {
    const { minLevel, maxLevel, defaultRetailLevel, defaultWhaleLevel } = CONFIG;
    const toLevel = (value: number, fallback: number, min: number, max: number): number =>
        Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : fallback;

    let retail = toLevel(retailLevel, defaultRetailLevel, minLevel, maxLevel - 1);
    let whale = toLevel(whaleLevel, defaultWhaleLevel, minLevel + 1, maxLevel);

    if (retail >= whale) {
        if (prefer === "retail") {
            whale = retail + 1;
        } else {
            retail = whale - 1;
        }
    }

    return { retailLevel: retail, whaleLevel: whale };
}

/**
 * 計算指定級距範圍內的人數、股數與比例
 */
function sumGroup(
    levels: readonly StockLevelData[],
    range: [number, number] | null,
    method: "shares" | "percent",
    totalShares: number | null,
    totalHolders: number,
): GroupTotals {
    let holders = 0;
    let shares = 0;
    let percentSum = 0;

    if (range) {
        const [from, to] = range;

        for (const item of levels) {
            if (item.level < from || item.level > to) {
                continue;
            }

            holders += item.holders;
            shares += item.shares ?? 0;
            percentSum += item.percent ?? 0;
        }
    }

    const percent = method === "shares" && totalShares ? (shares / totalShares) * 100 : percentSum;

    return {
        range,
        percent,
        holders,
        holderRatio: totalHolders > 0 ? (holders / totalHolders) * 100 : null,
        shares: method === "shares" ? shares : null,
    };
}

/**
 * 決定比例計算的分母 (合計股數)
 *
 * 1. 優先使用 TDCC「合計」列股數 (= 1~15 級股數 + 差異數調整，TDCC 比例欄即以此為分母)
 * 2. 合計列缺漏時，以 1~15 級股數加總再加上差異數調整推算
 */
function resolveTotalShares(parsed: Pick<ParseResult, "levels" | "total" | "adjustment">): number | null {
    const totalRowShares = parsed.total?.shares ?? null;

    if (totalRowShares !== null && totalRowShares > 0) {
        return totalRowShares;
    }

    const derived = parsed.levels.reduce((sum, item) => sum + (item.shares ?? 0), 0) + (parsed.adjustment?.shares ?? 0);
    return derived > 0 ? derived : null;
}

/**
 * 依據散戶與大戶門檻，計算大戶、中實戶、散戶三個族群的持股比例與人數
 *
 * - 散戶：級距 1 ~ retailLevel
 * - 中實戶：級距 retailLevel+1 ~ whaleLevel-1 (介於兩門檻之間，可能為空)
 * - 大戶：級距 whaleLevel ~ 15
 *
 * 比例計算方式：
 * - 所有級距皆有股數時，以「族群股數 ÷ 合計股數 × 100」精算。
 *   TDCC 比例欄位是「無條件捨去」至小數第 2 位 (以 2026/10/30 全市場 61,665 個欄位驗證)，
 *   直接加總會讓每個級距少算 0 ~ 0.01 個百分點，族群涵蓋的級距越多低估越多 (散戶 9 個級距最多約 0.09)
 * - 分母使用「合計」列股數，與 TDCC「占集保庫存數比例」欄位的分母一致
 * - 股數資料不完整時，退回加總比例欄位
 *
 * @param parsed - 股權分散表解析結果 (至少需包含 levels，可選 total 與 adjustment)
 * @param retailLevel - 散戶門檻
 * @param whaleLevel - 大戶門檻
 * @returns 三個族群的統計結果
 */
export function calculateDistribution(
    parsed: Pick<ParseResult, "levels"> & Partial<Pick<ParseResult, "total" | "adjustment">>,
    retailLevel: number,
    whaleLevel: number,
): Distribution {
    const thresholds = normalizeThresholds(retailLevel, whaleLevel);
    const levels = parsed.levels;
    const source = { levels, total: parsed.total ?? null, adjustment: parsed.adjustment ?? null };

    const allSharesKnown = levels.length > 0 && levels.every((item) => item.shares !== null);
    const totalShares = allSharesKnown ? resolveTotalShares(source) : null;
    const method = totalShares !== null ? "shares" : "percent";

    const levelHolders = levels.reduce((sum, item) => sum + item.holders, 0);
    const totalRowHolders = source.total?.holders ?? null;
    const totalHolders = totalRowHolders !== null && totalRowHolders > 0 ? totalRowHolders : levelHolders;

    const { retailLevel: retail, whaleLevel: whale } = thresholds;
    const middleRange: [number, number] | null = whale - retail > 1 ? [retail + 1, whale - 1] : null;

    return {
        retailLevel: retail,
        whaleLevel: whale,
        whale: sumGroup(levels, [whale, CONFIG.maxLevel], method, totalShares, totalHolders),
        middle: sumGroup(levels, middleRange, method, totalShares, totalHolders),
        retail: sumGroup(levels, [CONFIG.minLevel, retail], method, totalShares, totalHolders),
        totalHolders,
        totalShares,
        method,
        levelCount: levels.length,
    };
}
