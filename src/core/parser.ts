import { CONFIG, LEVELS } from "../config/constants.js";
import type { ParseResult, StockLevelData, StockMeta, SummaryRow } from "../types/index.js";

/** 一般空白、不換行空白 (NBSP) 與全形空白 (U+3000) */
const WHITESPACE_PATTERN = /[\s 　]+/g;

/** 合法數字格式：可選正負號、整數或小數 */
const NUMBER_PATTERN = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** 表頭必須同時包含的關鍵字，用來辨識股權分散表 */
const HEADER_KEYWORDS = ["持股", "人數", "股數"] as const;

/**
 * 移除文字中的所有空白 (含全形空白)
 * 例如 TDCC 合計列顯示為「合　計」
 */
function compactText(rawText: string | null | undefined): string {
    return (rawText ?? "").replace(WHITESPACE_PATTERN, "");
}

/**
 * 將 TDCC 表格中的數字文字 (可能包含千分位逗號、百分比符號、空白) 解析為數值
 *
 * 與 parseFloat 不同，本函式採嚴格比對：「12abc」這類殘缺內容會回傳 null，而非 12
 *
 * @param rawText - 原始文字，例如 " 2,594,858 "、"84.42"、"-0.00"、"-4,000"
 * @returns 解析後的數值；空白或格式不符時回傳 null (負零會正規化為 0)
 */
export function parseNumber(rawText: string | null | undefined): number | null {
    const normalized = compactText(rawText).replace(/[,，%％]/g, "");

    if (!NUMBER_PATTERN.test(normalized)) {
        return null;
    }

    const value = Number(normalized);

    if (!Number.isFinite(value)) {
        return null;
    }

    // 將 -0 正規化為 0
    return value === 0 ? 0 : value;
}

/**
 * 解析非負整數 (用於序號與人數)
 */
function parseNonNegativeInteger(rawText: string | null | undefined): number | null {
    const value = parseNumber(rawText);
    return value !== null && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * 取得節點本身的文字，不含巢狀表格內的文字
 */
function ownText(node: Node): string {
    let text = "";

    node.childNodes.forEach((child) => {
        if (child.nodeType === 3) {
            text += child.nodeValue ?? "";
        } else if (child.nodeType === 1 && (child as Element).tagName !== "TABLE") {
            text += ownText(child);
        }
    });

    return text;
}

/**
 * 判斷表格的表頭列是否為股權分散表：表頭列本身需有至少 5 個儲存格，且包含「持股 / 人數 / 股數」
 *
 * 只看表頭列自己的儲存格 (不含巢狀表格文字)，因此：
 * - 外層版面表格 (只有 1 個儲存格包住整個結果區塊) 不會被誤選
 * - 股權分散表的某個儲存格內含小表格時仍可正確辨識
 */
function isDistributionHeader(table: HTMLTableElement): boolean {
    const headerRow = table.tHead?.rows[0] ?? table.rows[0];

    if (!headerRow || headerRow.cells.length < 5) {
        return false;
    }

    const headerText = compactText(ownText(headerRow));
    return HEADER_KEYWORDS.every((keyword) => headerText.includes(keyword));
}

/**
 * 在頁面中尋找 TDCC 集保戶股權分散表
 *
 * 優先以表頭關鍵字 (持股 / 人數 / 股數) 辨識，避免誤抓頁面上其他表格；
 * 若找不到符合的表頭，則退回使用第一個 `table.table` (舊版選擇器行為)
 *
 * @param root - 搜尋範圍 (Document 或任一容器)
 * @returns 股權分散表元素；找不到時回傳 null
 */
export function findDistributionTable(root: ParentNode): HTMLTableElement | null {
    let fallback: HTMLTableElement | null = null;

    for (const table of Array.from(root.querySelectorAll<HTMLTableElement>("table"))) {
        if (isDistributionHeader(table)) {
            return table;
        }

        if (!fallback && table.classList.contains("table")) {
            fallback = table;
        }
    }

    return fallback;
}

/**
 * 從級距說明文字 (例如 "50,001-100,000"、"1,000,001以上") 取出下限股數
 */
function parseLevelLowerBound(label: string): number | null {
    const match = /^[\d,]+/.exec(label);
    return match ? parseNumber(match[0]) : null;
}

/**
 * 從查詢結果區塊解析證券代號、證券名稱與資料日期
 *
 * TDCC 頁面格式：
 * ```
 * 證券代號：2330
 * 證券名稱：台積電
 * 資料日期：115年10月22日
 * ```
 * 查詢表單中的「證券代號」標籤沒有全形冒號，因此不會被誤判
 *
 * @param doc - DOM Document
 * @param table - 已找到的股權分散表 (用來縮小搜尋範圍)
 */
export function parseStockMeta(doc: Document, table: HTMLTableElement | null = null): StockMeta {
    const scope = table?.closest("main") ?? doc.querySelector("main") ?? doc.body;
    const text = scope?.textContent ?? "";

    const pick = (pattern: RegExp): string | null => {
        const value = pattern.exec(text)?.[1]?.trim();
        return value ? value : null;
    };

    // 壓縮過的 HTML 中 <br> 與元素邊界不會產生換行：
    // 證券名稱擷取到換行或下一個欄位標籤為止；資料日期直接比對日期格式 (民國年月日或 8 碼西元日期)
    return {
        stockNo: pick(/證券代號[：:][^\S\r\n]*([0-9A-Za-z]+)/),
        stockName: pick(/證券名稱[：:][^\S\r\n]*(.*?)(?=證券代號[：:]|資料日期[：:]|[\r\n]|$)/),
        dataDate: pick(/資料日期[：:][^\S\r\n]*(\d{2,3}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[/-]?\d{2}[/-]?\d{2})/),
    };
}

/**
 * 讀取查詢表單中「證券代號」輸入框由伺服器回填的值 (HTML value 屬性)
 *
 * TDCC「查無此資料」的回應不會顯示「證券代號：」，但會把查詢時輸入的代號回填到 HTML value 屬性。
 * 讀取屬性而非輸入框目前的 .value，避免使用者正在輸入的新代號被誤認為查詢結果
 */
function readQueriedStockNo(doc: Document): string | null {
    const value = doc.querySelector<HTMLInputElement>("input#StockNo, input[name='stockNo']")?.getAttribute("value")?.trim();
    return value ? value : null;
}

/**
 * 從 TDCC 網頁中的股權分散表解析各級距資料
 *
 * 表格欄位結構 (實際 TDCC 頁面)：
 * - 欄位 0: 序 (1 ~ 15 為持股分級；16 為差異數調整、17 為合計；
 *   沒有差異數調整列的證券 (例如 0050) 則 16 為合計，因此特殊列以文字辨識優先)
 * - 欄位 1: 持股/單位數分級 (如 "1-999"、"1,000,001以上"、"差異數調整（說明4）"、"合　計")
 * - 欄位 2: 人數
 * - 欄位 3: 股數/單位數
 * - 欄位 4: 占集保庫存數比例 (%)
 *
 * @param doc - DOM Document 物件 (預設為全域 document，便於單元測試注入 Mock DOM)
 * @returns 解析結果 (含狀態、級距資料、合計列、差異數調整列與證券資訊)
 */
export function parseStockPage(doc: Document = document): ParseResult {
    const table = findDistributionTable(doc);
    const meta = parseStockMeta(doc, table);

    if (!table) {
        return { status: "no-table", levels: [], adjustment: null, total: null, meta, warnings: [] };
    }

    const levels: StockLevelData[] = [];
    const seenLevels = new Set<number>();
    const warnings: string[] = [];
    let adjustment: SummaryRow | null = null;
    let total: SummaryRow | null = null;

    for (const row of Array.from(table.rows)) {
        // 略過表頭列
        if (row.parentElement?.tagName === "THEAD") {
            continue;
        }

        const cells = row.cells;

        // 需至少 5 欄 (「查無此資料」列為 colspan=5 的單一欄位，會在此被略過)
        if (cells.length < 5) {
            continue;
        }

        const rowNo = parseNonNegativeInteger(cells[0]?.textContent);
        const label = compactText(cells[1]?.textContent);
        const summary: SummaryRow = {
            holders: parseNumber(cells[2]?.textContent),
            shares: parseNumber(cells[3]?.textContent),
            percent: parseNumber(cells[4]?.textContent),
        };

        if (rowNo === CONFIG.totalRowNo || label.includes("合計")) {
            total = summary;
            continue;
        }

        if (rowNo === CONFIG.adjustmentRowNo || label.includes("差異數")) {
            adjustment = summary;
            continue;
        }

        if (rowNo === null || rowNo < CONFIG.minLevel || rowNo > CONFIG.maxLevel || seenLevels.has(rowNo)) {
            continue;
        }

        const holders = summary.holders;
        const shares = summary.shares !== null && summary.shares >= 0 ? summary.shares : null;
        const percent = summary.percent;

        // 人數必須為非負整數，且股數與比例至少要有一項有效
        if (holders === null || !Number.isInteger(holders) || holders < 0 || (shares === null && percent === null)) {
            continue;
        }

        // 檢查 TDCC 級距區間是否與內建定義一致 (防止 TDCC 調整級距後標籤錯誤)
        const expectedMin = LEVELS[rowNo - 1]?.minShares;
        const actualMin = parseLevelLowerBound(label);

        if (actualMin !== null && expectedMin !== undefined && actualMin !== expectedMin) {
            warnings.push(`第 ${rowNo} 級區間「${label}」與預期不符`);
        }

        seenLevels.add(rowNo);
        levels.push({ level: rowNo, holders, shares, percent });
    }

    levels.sort((a, b) => a.level - b.level);

    if (levels.length === 0 && !meta.stockNo) {
        meta.stockNo = readQueriedStockNo(doc);
    }

    return {
        status: levels.length > 0 ? "ok" : "no-data",
        levels,
        adjustment,
        total,
        meta,
        warnings,
    };
}
