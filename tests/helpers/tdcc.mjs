/**
 * 測試輔助工具：
 * - 讀取 fixture
 * - 依 TDCC 實際 HTML 結構產生股權分散表頁面
 * - 建立 jsdom 環境
 * - 與產品程式碼完全獨立的「參考計算」(用整數股數直接計算，作為正確答案)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = path.resolve(here, "../fixtures");
export const TDCC_URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock";

/** 讀取 fixture 檔案內容 */
export function readFixture(name) {
    return fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8");
}

/**
 * 建立 jsdom 環境
 * @param {string} html
 */
export function createDom(html) {
    return new JSDOM(html, { url: TDCC_URL, pretendToBeVisual: true, runScripts: "outside-only" });
}

/**
 * 解析 TDCC 開放資料 CSV (資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%)
 * @returns {Map<string, {date: string, rows: Record<number, {holders: number, shares: number, percent: number}>}>}
 */
export function parseOpenDataCsv(text) {
    const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/).slice(1);
    const securities = new Map();

    for (const line of lines) {
        const [date, rawCode, level, holders, shares, percent] = line.split(",");
        const code = rawCode.trim();

        if (!securities.has(code)) {
            securities.set(code, { date, rows: {} });
        }

        securities.get(code).rows[Number(level)] = {
            holders: Number(holders),
            shares: Number(shares),
            percent: Number(percent),
        };
    }

    return securities;
}

const LEVEL_LABELS = [
    "1-999", "1,000-5,000", "5,001-10,000", "10,001-15,000", "15,001-20,000", "20,001-30,000",
    "30,001-40,000", "40,001-50,000", "50,001-100,000", "100,001-200,000", "200,001-400,000",
    "400,001-600,000", "600,001-800,000", "800,001-1,000,000", "1,000,001以上",
];

const fmt = (value) => Number(value).toLocaleString("en-US");

/**
 * 依 TDCC 實際回應的 HTML 結構產生查詢結果頁面
 * (沒有明確 <tbody>、數字含千分位、合計列為「合　計」、差異數調整列人數為 0 時留白)
 */
export function buildTdccPage({ stockNo = "", stockName = "", dataDate = "", rows }) {
    const tr = (no, label, holders, shares, percent) => `
                            <tr>
                                <td align="center">${no}</td>
                                <td align="center">${label}</td>
                                <td align="right">${holders}</td>
                                <td align="right">${shares}</td>
                                <td align="right">${percent}</td>
                            </tr>`;

    const body = [];

    for (let level = 1; level <= 15; level += 1) {
        const row = rows[level];
        if (row) {
            body.push(tr(level, LEVEL_LABELS[level - 1], fmt(row.holders), fmt(row.shares), row.percent.toFixed(2)));
        }
    }

    if (rows[16]) {
        // 開放資料 CSV 的差異數調整只記錄絕對值，網頁則顯示帶正負號的數值 (例如 "-4,000"、"-0.00")；
        // 依「1~15 級股數 + 差異數調整 = 合計」還原正負號，與實際網頁一致
        const adj = rows[16];
        const sign = signedAdjustment(rows) < 0 ? "-" : "";
        body.push(tr(16, "差異數調整（說明4）", adj.holders ? fmt(adj.holders) : "", `${sign}${fmt(adj.shares)}`, `${sign}${adj.percent.toFixed(2)}`));
    }

    if (rows[17]) {
        const total = rows[17];
        body.push(tr(17, "合　計", fmt(total.holders), fmt(total.shares), total.percent.toFixed(2)));
    }

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><main role="main">
        <div>
            <p>
                證券代號：${stockNo}
                <br>
                證券名稱：${stockName}
            </p>
            <span class="font" style="font-size: 0.813em;">資料日期：${dataDate}</span>
        </div>
        <div class="table-frame securities-overview m-t-20">
            <div class="table-responsive" style="max-height:100%;">
                <table class="table" data-testid="distribution">
                    <thead>
                    <tr>
                        <th>序</th>
                        <th>持股/單位數分級</th>
                        <th>人數</th>
                        <th>股數/單位數</th>
                        <th>占集保庫存數比例 (%)</th>
                    </tr>
                    </thead>
                    ${body.join("")}
                </table>
            </div>
        </div>
    </main></body></html>`;
}

/**
 * 還原差異數調整的正負號：合計股數 - 1~15 級股數加總
 */
export function signedAdjustment(rows) {
    let levelShares = 0;
    for (let level = 1; level <= 15; level += 1) {
        levelShares += rows[level].shares;
    }
    return rows[17].shares - levelShares;
}

/**
 * TDCC 比例欄位的產生方式：股數 ÷ 合計股數 × 100，「無條件捨去」至小數第 2 位
 * (以 BigInt 精確計算，回傳單位為 0.01%)
 */
export function tdccTruncatedPercentHundredths(shares, totalShares) {
    return Number((BigInt(shares) * 10000n) / BigInt(totalShares));
}

/**
 * 參考計算 (獨立於產品程式碼)：直接以整數股數計算各族群比例
 * - 散戶：1 ~ retail；中實戶：retail+1 ~ whale-1；大戶：whale ~ 15
 * - 分母：合計列股數
 */
export function referenceDistribution(rows, retail, whale) {
    const sum = (from, to, key) => {
        let total = 0;
        for (let level = from; level <= to; level += 1) {
            total += rows[level][key];
        }
        return total;
    };

    const totalShares = rows[17].shares;
    const totalHolders = rows[17].holders;
    const group = (from, to) => {
        if (from > to) {
            return { percent: 0, holders: 0, shares: 0 };
        }
        const shares = sum(from, to, "shares");
        return { percent: (shares / totalShares) * 100, holders: sum(from, to, "holders"), shares };
    };

    return {
        retail: group(1, retail),
        middle: group(retail + 1, whale - 1),
        whale: group(whale, 15),
        totalShares,
        totalHolders,
    };
}

/** 等待指定毫秒 */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 輪詢直到條件成立 (避免固定延遲在較慢的 CI 環境造成不穩定)
 * @returns {Promise<number>} 實際等待的毫秒數
 */
export async function waitFor(predicate, { timeout = 3000, interval = 10 } = {}) {
    const start = Date.now();

    while (!predicate()) {
        if (Date.now() - start > timeout) {
            throw new Error(`waitFor: 條件在 ${timeout}ms 內未成立`);
        }
        await delay(interval);
    }

    return Date.now() - start;
}
