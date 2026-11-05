import { CONFIG, LEVEL_ALIASES, LEVELS, SHARES_PER_LOT } from "../config/constants.js";
import type { LevelDefinition } from "../types/index.js";

/** 共用的千分位格式器 (避免每次格式化都重新建立 Intl 物件) */
const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const lotFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 });

/**
 * 將數值限制在 0 到 100 的百分比範圍內
 * 常用於安全設定 CSS 寬度，避免無效值或超出邊界
 *
 * @param value - 待限制的數值
 * @returns 限制在 [0, 100] 區間內的數值；若傳入非有限數字 (NaN/Infinity) 則回傳 0
 */
export function clampPercentage(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.min(Math.max(value, 0), 100);
}

/**
 * 將整數格式化為帶有千分位逗號的字串
 *
 * @param value - 數值
 * @returns 例如 "12,345"；非有限數值回傳 "--"
 */
export function formatInteger(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "--";
    }

    return integerFormatter.format(Math.round(value));
}

/**
 * 將人數格式化為帶有千分位逗號的顯示字串
 *
 * @param value - 人數數值
 * @returns 格式化後的字串 (例如: "12,345 人")，若非有效非負數則回傳 "-- 人"
 */
export function formatHolders(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
        return "-- 人";
    }

    return `${formatInteger(value)} 人`;
}

/**
 * 將百分比數值格式化為固定小數位數的字串
 *
 * @param value - 百分比數值
 * @param digits - 小數位數 (預設 2)
 * @returns 例如 "84.42%"；非有限數值回傳 "--%"
 */
export function formatPercent(value: number | null | undefined, digits = 2): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "--%";
    }

    // 避免 -0.00% 這類負零顯示
    const fixed = value.toFixed(digits);
    return `${Number(fixed) === 0 ? (0).toFixed(digits) : fixed}%`;
}

/**
 * 將股數換算為張數並格式化 (1 張 = 1,000 股，四捨五入至整數張)
 *
 * @param shares - 股數
 * @returns 例如 "21,893,081 張"；非有效數值回傳 "-- 張"
 */
export function formatLots(shares: number | null | undefined): string {
    if (shares === null || shares === undefined || !Number.isFinite(shares) || shares < 0) {
        return "-- 張";
    }

    return `${formatInteger(shares / SHARES_PER_LOT)} 張`;
}

/**
 * 計算並格式化每人平均持有張數 (小於 10 張時保留 2 位小數)
 *
 * @param shares - 合計股數
 * @param holders - 人數
 * @returns 例如 "14,833 張"、"0.84 張"；資料無效時回傳 "--"
 */
export function formatAverageLots(shares: number | null | undefined, holders: number | null | undefined): string {
    if (shares === null || shares === undefined || holders === null || holders === undefined || !(holders > 0) || !(shares >= 0)) {
        return "--";
    }

    const average = shares / SHARES_PER_LOT / holders;
    return `${average < 10 ? average.toFixed(2) : formatInteger(average)} 張`;
}

/**
 * 取得指定級距的定義
 *
 * @param level - 級距編號 (1 ~ 15)
 * @returns 級距定義；超出範圍時拋出錯誤
 */
export function getLevelDefinition(level: number): LevelDefinition {
    const definition = LEVELS[level - 1];

    if (!definition || definition.level !== level) {
        throw new RangeError(`Invalid TDCC level: ${level}`);
    }

    return definition;
}

/** 將股數換算為張數字串 (保留必要小數，例如 0.999) */
function lots(shares: number): string {
    return lotFormatter.format(shares / SHARES_PER_LOT);
}

/**
 * 級距下限的「張」描述
 * - 下限為整張 (例如 1,000 股) → "≥ 1 張"
 * - 下限為 X,001 股 → "> X 張"
 */
function lowerBoundLabel(definition: LevelDefinition): string {
    if (definition.minShares % SHARES_PER_LOT === 0) {
        return `≥ ${lots(definition.minShares)} 張`;
    }

    return `> ${lots(definition.minShares - 1)} 張`;
}

/**
 * 級距上限的「張」描述
 * - 第 1 級 (1 ~ 999 股) → "< 1 張"
 * - 其餘 → "≤ X 張"
 */
function upperBoundLabel(definition: LevelDefinition): string {
    if (definition.maxShares === null) {
        return "不限";
    }

    if (definition.maxShares < SHARES_PER_LOT) {
        return `< 1 張`;
    }

    return `≤ ${lots(definition.maxShares)} 張`;
}

/**
 * 散戶門檻下拉選單文字：散戶 = 級距 1 ~ level，因此以該級距的「上限」描述
 *
 * @example retailOptionLabel(9)  // "≤ 100 張"
 * @example retailOptionLabel(1)  // "< 1 張（零股）"
 */
export function retailOptionLabel(level: number): string {
    const base = upperBoundLabel(getLevelDefinition(level));
    const alias = LEVEL_ALIASES[`retail:${level}`];
    return alias ? `${base} · ${alias}` : base;
}

/**
 * 大戶門檻下拉選單文字：大戶 = 級距 level ~ 15，因此以該級距的「下限」描述
 *
 * @example whaleOptionLabel(15)  // "> 1,000 張 · 千張大戶"
 * @example whaleOptionLabel(12)  // "> 400 張 · 400張大戶"
 */
export function whaleOptionLabel(level: number): string {
    const base = lowerBoundLabel(getLevelDefinition(level));
    const alias = LEVEL_ALIASES[`whale:${level}`];
    return alias ? `${base} · ${alias}` : base;
}

/**
 * 收合摘要用的大戶簡稱 (含門檻)，讓使用者一眼看出目前「大戶」的定義
 *
 * @example whaleShortLabel(15)  // "千張大戶"
 * @example whaleShortLabel(10)  // ">100張大戶"
 */
export function whaleShortLabel(level: number): string {
    const alias = LEVEL_ALIASES[`whale:${level}`];
    return alias ?? `${lowerBoundLabel(getLevelDefinition(level)).replace(/\s/g, "")}大戶`;
}

/**
 * 收合摘要用的散戶簡稱 (含門檻)
 *
 * @example retailShortLabel(9)  // "≤100張散戶"
 * @example retailShortLabel(1)  // "<1張散戶"
 */
export function retailShortLabel(level: number): string {
    return `${upperBoundLabel(getLevelDefinition(level)).replace(/\s/g, "")}散戶`;
}

/**
 * 級距範圍的股數描述 (與 TDCC 表格一致)
 *
 * @example levelShareRange(9)   // "50,001–100,000 股"
 * @example levelShareRange(15)  // "1,000,001 股以上"
 */
export function levelShareRange(level: number): string {
    const definition = getLevelDefinition(level);

    if (definition.maxShares === null) {
        return `${formatInteger(definition.minShares)} 股以上`;
    }

    return `${formatInteger(definition.minShares)}–${formatInteger(definition.maxShares)} 股`;
}

/**
 * 級距範圍的張數簡述 (用於明細表)
 *
 * @example levelLotRange(1)   // "< 1"
 * @example levelLotRange(9)   // "50–100"
 * @example levelLotRange(15)  // "> 1,000"
 */
export function levelLotRange(level: number): string {
    const definition = getLevelDefinition(level);

    if (definition.maxShares === null) {
        return `> ${lots(definition.minShares - 1)}`;
    }

    if (definition.maxShares < SHARES_PER_LOT) {
        return "< 1";
    }

    const lower = definition.minShares % SHARES_PER_LOT === 0
        ? definition.minShares
        : definition.minShares - 1;

    return `${lots(lower)}–${lots(definition.maxShares)}`;
}

/**
 * 族群 (連續級距範圍) 的張數描述
 *
 * @param range - 級距範圍 [起, 迄]；null 表示空範圍
 * @example groupRangeLabel([1, 9])    // "≤ 100 張"
 * @example groupRangeLabel([10, 14])  // "> 100 ~ ≤ 1,000 張"
 * @example groupRangeLabel([15, 15])  // "> 1,000 張"
 */
export function groupRangeLabel(range: [number, number] | null): string {
    if (!range) {
        return "無";
    }

    const [from, to] = range;
    const first = getLevelDefinition(from);
    const last = getLevelDefinition(to);

    if (from === CONFIG.minLevel && to === CONFIG.maxLevel) {
        return "全部";
    }

    if (from === CONFIG.minLevel) {
        return upperBoundLabel(last);
    }

    if (to === CONFIG.maxLevel) {
        return lowerBoundLabel(first);
    }

    return `${lowerBoundLabel(first).replace(/ 張$/, "")} ~ ${upperBoundLabel(last)}`;
}

/**
 * 族群 (連續級距範圍) 的股數區間描述
 *
 * @example groupShareRange([10, 14])  // "100,001–1,000,000 股 (第 10–14 級)"
 */
export function groupShareRange(range: [number, number] | null): string {
    if (!range) {
        return "無對應級距";
    }

    const [from, to] = range;
    const first = getLevelDefinition(from);
    const last = getLevelDefinition(to);
    const levels = from === to ? `第 ${from} 級` : `第 ${from}–${to} 級`;

    if (last.maxShares === null) {
        return `${formatInteger(first.minShares)} 股以上（${levels}）`;
    }

    return `${formatInteger(first.minShares)}–${formatInteger(last.maxShares)} 股（${levels}）`;
}
