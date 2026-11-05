import { CONFIG, HOST_ID, HOST_TAG } from "../config/constants.js";
import { levelLotRange, levelShareRange, retailOptionLabel, whaleOptionLabel } from "../core/format.js";
import type { GroupKey } from "../types/index.js";
import { PANEL_STYLES } from "./styles.js";

/**
 * 單一族群 (大戶 / 中實戶 / 散戶) 的顯示元件
 */
export interface GroupElements {
    item: HTMLLIElement;
    range: HTMLElement;
    percent: HTMLElement;
    holders: HTMLElement;
    lots: HTMLElement;
    bar: HTMLElement;
}

/**
 * 明細表中單一級距列的顯示元件
 */
export interface LevelRowElements {
    row: HTMLTableRowElement;
    holders: HTMLTableCellElement;
    percent: HTMLTableCellElement;
}

/**
 * 明細表底部族群合計列的顯示元件
 */
export interface GroupTotalRowElements {
    row: HTMLTableRowElement;
    range: HTMLTableCellElement;
    holders: HTMLTableCellElement;
    percent: HTMLTableCellElement;
}

/**
 * 統計面板中的 DOM 元素集合
 */
export interface PanelElements {
    /** Shadow DOM 宿主元素 (掛載於頁面 body) */
    host: HTMLElement;
    /** Shadow Root */
    root: ShadowRoot;
    /** 面板主容器 */
    panel: HTMLElement;
    /** 標題列 (點擊收合、拖曳移動) */
    header: HTMLElement;
    /** 標題文字 (展開時為「持股比例統計」，收合時為證券資訊) */
    title: HTMLElement;
    /** 標題列副標題 (證券資訊或收合時的摘要) */
    subtitle: HTMLElement;
    /** 收合 / 展開按鈕 */
    toggleButton: HTMLButtonElement;
    /** 內容區 */
    body: HTMLElement;
    /** 大戶門檻下拉選單 */
    whaleSelect: HTMLSelectElement;
    /** 散戶門檻下拉選單 */
    retailSelect: HTMLSelectElement;
    /** 門檻自動調整提示 */
    hint: HTMLElement;
    /** 狀態 / 警告訊息 */
    notice: HTMLElement;
    /** 計算結果區塊 */
    results: HTMLElement;
    /** 分布條 */
    bar: HTMLElement;
    /** 三個族群的顯示元件 */
    groups: Record<GroupKey, GroupElements>;
    /** 級距明細區塊 */
    details: HTMLDetailsElement;
    /** 級距明細列 (索引 0 為第 1 級) */
    levelRows: LevelRowElements[];
    /** 級距明細底部的族群合計列 */
    groupTotalRows: Record<GroupKey, GroupTotalRowElements>;
    /** 底部列 (狀態與操作按鈕) */
    footer: HTMLElement;
    /** 底部狀態文字 */
    footStatus: HTMLElement;
    /** 複製結果按鈕 */
    copyButton: HTMLButtonElement;
    /** 重新計算按鈕 */
    refreshButton: HTMLButtonElement;
    /** 螢幕閱讀器播報區 */
    live: HTMLElement;
}

const GROUP_TEMPLATE = (key: GroupKey, name: string): string => `
    <li class="group ${key}" data-ref="${key}-item">
        <div class="group-head">
            <span class="group-name">${name}</span>
            <span class="group-range" data-ref="${key}-range"></span>
            <span class="group-pct" data-ref="${key}-pct">--%</span>
        </div>
        <div class="group-meta">
            <span data-ref="${key}-holders" title="人數（占總股東人數比例）">-- 人</span>
            <span data-ref="${key}-lots" title="合計持有張數 (1 張 = 1,000 股)">-- 張</span>
        </div>
    </li>`;

const GROUP_TOTAL_TEMPLATE = (key: GroupKey, name: string): string => `
    <tr class="group-total ${key}" data-ref="${key}-total">
        <th scope="row">${name}</th>
        <td data-ref="${key}-total-range"></td>
        <td data-ref="${key}-total-holders">--</td>
        <td data-ref="${key}-total-pct">--</td>
    </tr>`;

const PANEL_TEMPLATE = `
<section class="panel" data-ref="panel" role="region" aria-label="TDCC 持股比例統計">
    <header class="header" data-ref="header" title="點擊收合 / 展開，拖曳可移動面板">
        <div class="title-wrap">
            <span class="icon" aria-hidden="true">📊</span>
            <div class="title-text">
                <h2 class="title" data-ref="title">持股比例統計</h2>
                <p class="subtitle" data-ref="subtitle">等待 TDCC 資料…</p>
            </div>
        </div>
        <button type="button" class="icon-btn" data-ref="toggle" aria-expanded="true" aria-controls="stk-body" aria-label="收合面板">
            <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
    </header>
    <div class="body" id="stk-body" data-ref="body">
        <div class="controls">
            <div class="field">
                <label class="field-label" for="stk-whale-level"><span class="dot whale" aria-hidden="true"></span>大戶門檻</label>
                <select id="stk-whale-level" data-ref="whale-select" aria-describedby="stk-whale-hint"></select>
                <span id="stk-whale-hint" class="sr-only">持股級距大於等於所選級距者視為大戶</span>
            </div>
            <div class="field">
                <label class="field-label" for="stk-retail-level"><span class="dot retail" aria-hidden="true"></span>散戶門檻</label>
                <select id="stk-retail-level" data-ref="retail-select" aria-describedby="stk-retail-hint"></select>
                <span id="stk-retail-hint" class="sr-only">持股級距小於等於所選級距者視為散戶</span>
            </div>
        </div>
        <p class="adjust-hint" data-ref="hint" hidden></p>
        <p class="notice" data-ref="notice" role="status" hidden></p>
        <div class="results" data-ref="results" hidden>
            <div class="bar" data-ref="bar" role="img" aria-label="持股分布">
                <span class="seg whale" data-ref="whale-bar"></span>
                <span class="seg middle" data-ref="middle-bar"></span>
                <span class="seg retail" data-ref="retail-bar"></span>
            </div>
            <ul class="groups">
                ${GROUP_TEMPLATE("whale", "大戶")}
                ${GROUP_TEMPLATE("middle", "中實戶")}
                ${GROUP_TEMPLATE("retail", "散戶")}
            </ul>
            <details class="details" data-ref="details">
                <summary>級距明細</summary>
                <table class="level-table">
                    <thead>
                        <tr>
                            <th scope="col">級</th>
                            <th scope="col">持股（張）</th>
                            <th scope="col">人數</th>
                            <th scope="col">比例</th>
                        </tr>
                    </thead>
                    <tbody data-ref="level-rows"></tbody>
                    <tfoot>
                        ${GROUP_TOTAL_TEMPLATE("whale", "大戶合計")}
                        ${GROUP_TOTAL_TEMPLATE("middle", "中實戶合計")}
                        ${GROUP_TOTAL_TEMPLATE("retail", "散戶合計")}
                    </tfoot>
                </table>
                <p class="table-note">各級比例為 TDCC 公告值（小數第 3 位起無條件捨去），逐級加總可能略低於族群合計；族群合計依股數精算（族群股數 ÷ 合計股數）。</p>
            </details>
        </div>
        <div class="footer" data-ref="footer" hidden>
            <span class="foot-status" data-ref="foot-status">尚未取得資料</span>
            <div class="actions">
                <button type="button" class="text-btn" data-ref="copy" disabled>複製結果</button>
                <button type="button" class="text-btn" data-ref="refresh">重新計算</button>
            </div>
        </div>
        <p class="sr-only" data-ref="live" aria-live="polite" aria-atomic="true"></p>
    </div>
</section>`;

/**
 * 從容器中查找指定 data-ref 的元素，若未找到則拋出錯誤
 */
function requireRef<T extends Element>(root: ParentNode, ref: string): T {
    const element = root.querySelector<T>(`[data-ref="${ref}"]`);

    if (!element) {
        throw new Error(`Missing required element: ${ref}`);
    }

    return element;
}

/**
 * 建立下拉選單選項
 *
 * @param doc - DOM Document
 * @param select - 下拉選單
 * @param from - 起始級距
 * @param to - 結束級距
 * @param label - 選項文字產生函式
 */
function fillOptions(doc: Document, select: HTMLSelectElement, from: number, to: number, label: (level: number) => string): void {
    const fragment = doc.createDocumentFragment();

    for (let level = from; level <= to; level += 1) {
        const option = doc.createElement("option");
        option.value = String(level);
        option.textContent = label(level);
        option.title = levelShareRange(level);
        fragment.appendChild(option);
    }

    select.appendChild(fragment);
}

/**
 * 建立級距明細表的 15 列
 */
function buildLevelRows(doc: Document, tbody: HTMLTableSectionElement): LevelRowElements[] {
    const rows: LevelRowElements[] = [];

    for (let level = CONFIG.minLevel; level <= CONFIG.maxLevel; level += 1) {
        const row = doc.createElement("tr");
        row.title = levelShareRange(level);

        const levelCell = doc.createElement("td");
        levelCell.textContent = String(level);

        const rangeCell = doc.createElement("td");
        rangeCell.textContent = levelLotRange(level);

        const holders = doc.createElement("td");
        holders.textContent = "--";

        const percent = doc.createElement("td");
        percent.textContent = "--";

        row.append(levelCell, rangeCell, holders, percent);
        tbody.appendChild(row);
        rows.push({ row, holders, percent });
    }

    return rows;
}

/**
 * 移除畫面上既有的統計面板 (若存在)
 * 用於擴充功能重新載入或重複注入時，避免畫面出現多個面板
 *
 * @param doc - DOM Document 物件 (預設為全域 document)
 */
export function removeExistingPanel(doc: Document = document): void {
    doc.getElementById(HOST_ID)?.remove();
}

/**
 * 建立統計面板 (Shadow DOM 宿主 + 內部結構) 並回傳所有元素參照
 *
 * 面板位於 Shadow DOM 中：
 * - 頁面 CSS 不會影響面板外觀，面板樣式也不會外洩到頁面
 * - 面板內的 DOM 變動不會觸發頁面上監聽 document.body 的 MutationObserver
 *
 * @param doc - DOM Document 物件 (預設為全域 document)
 * @returns 面板元素集合 (尚未掛載到頁面)
 */
export function createPanel(doc: Document = document): PanelElements {
    const host = doc.createElement(HOST_TAG);
    host.id = HOST_ID;

    const root = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = PANEL_STYLES;
    root.appendChild(style);

    const template = doc.createElement("template");
    template.innerHTML = PANEL_TEMPLATE.trim();
    root.appendChild(template.content);

    const whaleSelect = requireRef<HTMLSelectElement>(root, "whale-select");
    const retailSelect = requireRef<HTMLSelectElement>(root, "retail-select");
    fillOptions(doc, whaleSelect, CONFIG.minLevel + 1, CONFIG.maxLevel, whaleOptionLabel);
    fillOptions(doc, retailSelect, CONFIG.minLevel, CONFIG.maxLevel - 1, retailOptionLabel);

    const group = (key: GroupKey): GroupElements => ({
        item: requireRef<HTMLLIElement>(root, `${key}-item`),
        range: requireRef<HTMLElement>(root, `${key}-range`),
        percent: requireRef<HTMLElement>(root, `${key}-pct`),
        holders: requireRef<HTMLElement>(root, `${key}-holders`),
        lots: requireRef<HTMLElement>(root, `${key}-lots`),
        bar: requireRef<HTMLElement>(root, `${key}-bar`),
    });

    const groupTotal = (key: GroupKey): GroupTotalRowElements => ({
        row: requireRef<HTMLTableRowElement>(root, `${key}-total`),
        range: requireRef<HTMLTableCellElement>(root, `${key}-total-range`),
        holders: requireRef<HTMLTableCellElement>(root, `${key}-total-holders`),
        percent: requireRef<HTMLTableCellElement>(root, `${key}-total-pct`),
    });

    return {
        host,
        root,
        panel: requireRef<HTMLElement>(root, "panel"),
        header: requireRef<HTMLElement>(root, "header"),
        title: requireRef<HTMLElement>(root, "title"),
        subtitle: requireRef<HTMLElement>(root, "subtitle"),
        toggleButton: requireRef<HTMLButtonElement>(root, "toggle"),
        body: requireRef<HTMLElement>(root, "body"),
        whaleSelect,
        retailSelect,
        hint: requireRef<HTMLElement>(root, "hint"),
        notice: requireRef<HTMLElement>(root, "notice"),
        results: requireRef<HTMLElement>(root, "results"),
        bar: requireRef<HTMLElement>(root, "bar"),
        groups: {
            whale: group("whale"),
            middle: group("middle"),
            retail: group("retail"),
        },
        details: requireRef<HTMLDetailsElement>(root, "details"),
        levelRows: buildLevelRows(doc, requireRef<HTMLTableSectionElement>(root, "level-rows")),
        groupTotalRows: {
            whale: groupTotal("whale"),
            middle: groupTotal("middle"),
            retail: groupTotal("retail"),
        },
        footer: requireRef<HTMLElement>(root, "footer"),
        footStatus: requireRef<HTMLElement>(root, "foot-status"),
        copyButton: requireRef<HTMLButtonElement>(root, "copy"),
        refreshButton: requireRef<HTMLButtonElement>(root, "refresh"),
        live: requireRef<HTMLElement>(root, "live"),
    };
}
