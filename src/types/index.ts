/**
 * TDCC 持股分級定義 (1 ~ 15 級)
 */
export interface LevelDefinition {
    /** 持股分級編號 (1 ~ 15) */
    level: number;
    /** 該級距最小持股股數 (含) */
    minShares: number;
    /** 該級距最大持股股數 (含)；最高級距 (1,000,001 股以上) 為 null */
    maxShares: number | null;
}

/**
 * TDCC 表格解析出的單一級距資料
 */
export interface StockLevelData {
    /** 持股分級編號 (1 ~ 15) */
    level: number;
    /** 該級距股東人數 */
    holders: number;
    /** 該級距持有股數；無法解析時為 null */
    shares: number | null;
    /** 該級距佔集保庫存數比例 (%)，為 TDCC 無條件捨去至小數第 2 位的數值；無法解析時為 null */
    percent: number | null;
}

/**
 * 表格中的特殊列 (第 16 列「差異數調整」或第 17 列「合計」)
 */
export interface SummaryRow {
    /** 人數；空白時為 null */
    holders: number | null;
    /** 股數；空白時為 null */
    shares: number | null;
    /** 比例 (%)；空白時為 null */
    percent: number | null;
}

/**
 * 查詢結果頁面上的證券資訊
 */
export interface StockMeta {
    /** 證券代號 (例如 "2330") */
    stockNo: string | null;
    /** 證券名稱 (例如 "台積電") */
    stockName: string | null;
    /** 資料日期 (TDCC 原始顯示文字，例如 "115年10月22日") */
    dataDate: string | null;
}

/**
 * 解析狀態
 * - ok: 成功取得級距資料
 * - no-data: 找到股權分散表，但沒有任何級距資料 (例如「查無此資料」或尚未查詢)
 * - no-table: 頁面上找不到股權分散表
 */
export type ParseStatus = "ok" | "no-data" | "no-table";

/**
 * 股權分散表解析結果
 */
export interface ParseResult {
    status: ParseStatus;
    /** 依級距排序且不重複的 1 ~ 15 級資料 */
    levels: StockLevelData[];
    /** 第 16 列「差異數調整」 */
    adjustment: SummaryRow | null;
    /** 第 17 列「合計」 */
    total: SummaryRow | null;
    /** 證券代號、名稱與資料日期 */
    meta: StockMeta;
    /** 資料完整性警告 (例如 TDCC 級距區間與內建定義不符) */
    warnings: string[];
}

/**
 * 計算比例時採用的方法
 * - shares: 以各級距股數 ÷ 合計股數精算 (精確)
 * - percent: 加總 TDCC 已無條件捨去的比例欄位 (股數欄位缺漏時的備援)
 */
export type CalculationMethod = "shares" | "percent";

/** 持股族群鍵值 */
export type GroupKey = "whale" | "middle" | "retail";

/**
 * 單一持股族群 (大戶 / 中實戶 / 散戶) 的統計結果
 */
export interface GroupTotals {
    /** 族群涵蓋的級距範圍 [起, 迄] (含)；範圍為空時為 null */
    range: [number, number] | null;
    /** 族群持股比例 (%) */
    percent: number;
    /** 族群股東人數 */
    holders: number;
    /** 族群人數佔總股東人數的比例 (%)；總人數為 0 時為 null */
    holderRatio: number | null;
    /** 族群持有股數；股數資料不完整時為 null */
    shares: number | null;
}

/**
 * 大戶、中實戶、散戶持股分布計算結果
 */
export interface Distribution {
    /** 實際使用的散戶門檻 (已正規化) */
    retailLevel: number;
    /** 實際使用的大戶門檻 (已正規化) */
    whaleLevel: number;
    whale: GroupTotals;
    middle: GroupTotals;
    retail: GroupTotals;
    /** 總股東人數 */
    totalHolders: number;
    /** 計算比例時使用的分母股數 (合計股數)；以比例欄位計算時為 null */
    totalShares: number | null;
    /** 比例計算方法 */
    method: CalculationMethod;
    /** 實際解析到的級距數 (正常為 15) */
    levelCount: number;
}

/**
 * 面板拖曳後的位置 (相對於視窗左上角，單位 px)
 */
export interface PanelPosition {
    left: number;
    top: number;
}

/**
 * 使用者偏好設定 (會保存於 chrome.storage.local)
 */
export interface Settings {
    /** 散戶門檻：級距 <= 此值視為散戶 (1 ~ 14) */
    retailLevel: number;
    /** 大戶門檻：級距 >= 此值視為大戶 (2 ~ 15) */
    whaleLevel: number;
    /** 面板是否收合 */
    collapsed: boolean;
    /** 「級距明細」是否展開 */
    showDetails: boolean;
    /** 面板拖曳後的位置；null 表示使用預設位置 (右上角) */
    position: PanelPosition | null;
}
