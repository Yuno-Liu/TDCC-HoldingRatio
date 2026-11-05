import type { LevelDefinition } from "../types/index.js";

/** 面板 Shadow DOM 宿主元素的標籤名稱 (自訂元素名稱，避免被頁面的 div 等通用樣式影響) */
export const HOST_TAG = "tdcc-holding-ratio";

/** 面板 Shadow DOM 宿主元素 ID */
export const HOST_ID = "stk-helper-root";

/** chrome.storage.local 中保存使用者設定的鍵值 */
export const STORAGE_KEY = "tdccHoldingRatio.settings";

/** 1 張 = 1,000 股 */
export const SHARES_PER_LOT = 1000;

/**
 * 擴充功能核心配置
 */
export const CONFIG = {
    /** 最小持股分級編號 */
    minLevel: 1,
    /** 最大持股分級編號 */
    maxLevel: 15,
    /** TDCC 表格「差異數調整」列的序號 (沒有差異數調整列時，「合計」會是第 16 列，因此解析時以文字辨識為主) */
    adjustmentRowNo: 16,
    /** TDCC 表格「合計」列的序號 (有差異數調整列時) */
    totalRowNo: 17,
    /** 預設散戶門檻：級距 1 ~ 9 (100 張以下) */
    defaultRetailLevel: 9,
    /** 預設大戶門檻：級距 15 (超過 1,000 張，即「千張大戶」) */
    defaultWhaleLevel: 15,
    /** 頁面 DOM 變動後延遲重新解析的時間 (毫秒) */
    refreshDebounceMs: 120,
    /** 頁面持續變動時，最長延遲多久仍強制重新解析 (毫秒) */
    refreshMaxWaitMs: 1000,
    /** 門檻自動調整提示的顯示時間 (毫秒) */
    hintDurationMs: 4000,
    /** 讀取已保存設定的最長等待時間 (毫秒)，逾時則先以預設設定顯示面板 */
    settingsLoadTimeoutMs: 1500,
    /** 拖曳判定門檻：指標移動超過此距離 (px) 才視為拖曳而非點擊 */
    dragThresholdPx: 4,
    /** 面板與視窗邊緣的最小距離 (px) */
    viewportMarginPx: 8,
    /** 面板預設距視窗頂端的距離 (px)，位於 TDCC 主選單 (y 65 ~ 115) 下方 */
    defaultTopPx: 124,
    /** 面板展開時至少保持可見的內容高度 (px)；內容更高時於面板內捲動 */
    minVisibleBodyPx: 200,
    /** 自身寫入 chrome.storage 的回音最長等待時間 (毫秒)，逾時視為不會再收到 */
    echoTimeoutMs: 3000,
    /** 「差異數調整」占合計股數比例的絕對值達此門檻 (%) 時，顯示加總不等於 100% 的說明 */
    adjustmentNoticePercent: 0.05,
} as const;

/**
 * TDCC 集保戶股權分散表 1 ~ 15 級距的持股股數區間
 * 資料來源：TDCC 集保戶股權分散表「持股/單位數分級」欄位
 */
export const LEVELS: readonly LevelDefinition[] = [
    { level: 1, minShares: 1, maxShares: 999 },
    { level: 2, minShares: 1_000, maxShares: 5_000 },
    { level: 3, minShares: 5_001, maxShares: 10_000 },
    { level: 4, minShares: 10_001, maxShares: 15_000 },
    { level: 5, minShares: 15_001, maxShares: 20_000 },
    { level: 6, minShares: 20_001, maxShares: 30_000 },
    { level: 7, minShares: 30_001, maxShares: 40_000 },
    { level: 8, minShares: 40_001, maxShares: 50_000 },
    { level: 9, minShares: 50_001, maxShares: 100_000 },
    { level: 10, minShares: 100_001, maxShares: 200_000 },
    { level: 11, minShares: 200_001, maxShares: 400_000 },
    { level: 12, minShares: 400_001, maxShares: 600_000 },
    { level: 13, minShares: 600_001, maxShares: 800_000 },
    { level: 14, minShares: 800_001, maxShares: 1_000_000 },
    { level: 15, minShares: 1_000_001, maxShares: null },
];

/** 市場常用門檻的別名，會附加在下拉選單文字後方，並用於收合時的摘要 */
export const LEVEL_ALIASES: Readonly<Record<string, string>> = {
    "retail:1": "零股",
    "whale:12": "400張大戶",
    "whale:15": "千張大戶",
};
