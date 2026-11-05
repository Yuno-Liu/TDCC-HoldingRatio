import { CONFIG } from "../config/constants.js";

/**
 * 統計面板的 CSS 樣式 (注入於 Shadow DOM 內，與 TDCC 頁面樣式完全隔離)
 *
 * 色彩對比 (WCAG AA，白底)：
 * - 主要文字 #1e293b 14.6:1、次要文字 #475569 7.6:1、輔助文字 #64748b 4.8:1、控制項邊框 #7c8b9d 3.5:1
 * - 標題列白字於 #1e4f91 ~ #2a64b0 漸層 >= 5.9:1
 * - 大戶 #b45309 5.0:1、中實戶 #0f766e 5.5:1、散戶 #1d4ed8 6.7:1
 */
export const PANEL_STYLES = `
:host {
    all: initial;
}

*, *::before, *::after {
    box-sizing: border-box;
}

[hidden] {
    display: none !important;
}

.panel {
    --stk-bg: #ffffff;
    --stk-surface: #f8fafc;
    --stk-border: #dbe3ee;
    --stk-divider: #e8edf3;
    --stk-text: #1e293b;
    --stk-muted: #475569;
    --stk-subtle: #64748b;
    --stk-accent: #2f6fc0;
    --stk-focus: #2563eb;
    /* 表單控制項邊框：對白底 3.5:1 (WCAG 1.4.11 非文字對比 >= 3:1) */
    --stk-control-border: #7c8b9d;
    --stk-whale: #b45309;
    --stk-whale-bar: #d97706;
    --stk-middle: #0f766e;
    --stk-middle-bar: #0d9488;
    --stk-retail: #1d4ed8;
    --stk-retail-bar: #3b82f6;
    --stk-warn-bg: #fffbeb;
    --stk-warn-text: #92400e;

    position: fixed;
    /* 位於 TDCC 主選單 (y 65 ~ 115) 下方，避免遮住導覽列 */
    top: ${CONFIG.defaultTopPx}px;
    right: 20px;
    /* 高於 TDCC 頁首 (3) 與選單 (99)，低於 TDCC 彈窗 (999)、提示訊息 (1000) 與自動完成清單 */
    z-index: 990;
    width: min(320px, calc(100vw - 16px));
    /* 依預設位置保留下邊距；拖曳後由程式依實際位置調整 */
    max-height: calc(100vh - ${CONFIG.defaultTopPx + CONFIG.viewportMarginPx}px);
    display: flex;
    flex-direction: column;
    background: var(--stk-bg);
    border: 1px solid var(--stk-border);
    border-radius: 12px;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif;
    font-size: 13px;
    line-height: 1.45;
    color: var(--stk-text);
    text-align: left;
    overflow: hidden;
    transition: box-shadow 0.2s ease;
}

.panel:hover {
    box-shadow: 0 14px 34px rgba(15, 23, 42, 0.18), 0 3px 8px rgba(15, 23, 42, 0.08);
}

.panel.is-dragging {
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.24);
    opacity: 0.96;
}

.panel.is-dragging,
.panel.is-dragging * {
    user-select: none;
}

/* 標題列 (點擊收合 / 拖曳移動) */
.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 10px 10px 14px;
    background: linear-gradient(135deg, #1e4f91, #2a64b0);
    color: #ffffff;
    cursor: grab;
    user-select: none;
    touch-action: none;
    flex: none;
}

.panel.is-dragging .header {
    cursor: grabbing;
}

.title-wrap {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
}

.icon {
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.18);
    border-radius: 7px;
    font-size: 15px;
}

.title-text {
    min-width: 0;
}

.title {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    line-height: 1.3;
    letter-spacing: 0.2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.panel.is-collapsed .subtitle {
    font-weight: 600;
}

.subtitle {
    margin: 1px 0 0;
    font-size: 11px;
    line-height: 1.35;
    color: #ffffff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-variant-numeric: tabular-nums;
}

.icon-btn {
    flex: none;
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.12);
    color: inherit;
    cursor: pointer;
    transition: background 0.15s ease;
}

.icon-btn:hover {
    background: rgba(255, 255, 255, 0.24);
}

.icon-btn:focus-visible {
    outline: 2px solid #ffffff;
    outline-offset: 2px;
}

.chevron {
    width: 16px;
    height: 16px;
    transition: transform 0.2s ease;
}

.panel.is-collapsed .chevron {
    transform: rotate(-90deg);
}

/* 內容區 */
.body {
    padding: 14px 14px 12px;
    overflow-y: auto;
    overscroll-behavior: contain;
}

.panel.is-collapsed .body {
    display: none;
}

.controls {
    display: grid;
    /* 大戶選項文字較長 (例如「> 1,000 張 · 千張大戶」)，給予較寬欄位避免截斷 */
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 10px;
}

.field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
}

.field-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--stk-muted);
}

.field-hint {
    font-weight: 400;
    color: var(--stk-subtle);
}

select {
    width: 100%;
    min-width: 0;
    height: 32px;
    margin: 0;
    padding: 0 8px;
    background: var(--stk-bg);
    border: 1px solid var(--stk-control-border);
    border-radius: 7px;
    color: var(--stk-text);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

select:hover {
    border-color: #475569;
}

select:focus-visible {
    outline: 2px solid var(--stk-focus);
    outline-offset: 1px;
    border-color: var(--stk-focus);
}

/* 門檻自動調整提示 */
.adjust-hint {
    margin: 8px 0 0;
    font-size: 11.5px;
    color: var(--stk-muted);
}

.dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
}

.dot.whale { background: var(--stk-whale-bar); }
.dot.middle { background: var(--stk-middle-bar); }
.dot.retail { background: var(--stk-retail-bar); }

/* 狀態 / 警告訊息 */
.notice {
    margin: 12px 0 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--stk-surface);
    border: 1px dashed var(--stk-border);
    color: var(--stk-muted);
    font-size: 12px;
}

.notice.is-warning {
    background: var(--stk-warn-bg);
    border: 1px solid #fde68a;
    color: var(--stk-warn-text);
}

/* 分布條 */
.results {
    margin-top: 14px;
}

.bar {
    display: flex;
    width: 100%;
    height: 10px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--stk-divider);
}

.seg {
    display: block;
    height: 100%;
    width: 0;
    transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}

.seg + .seg {
    box-shadow: -1px 0 0 var(--stk-bg);
}

.seg.whale { background: var(--stk-whale-bar); }
.seg.middle { background: var(--stk-middle-bar); }
.seg.retail { background: var(--stk-retail-bar); }

/* 族群統計列 */
.groups {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.group {
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--stk-surface);
    border: 1px solid var(--stk-divider);
    border-left: 3px solid var(--group-bar);
}

.group.whale { --group-color: var(--stk-whale); --group-bar: var(--stk-whale-bar); }
.group.middle { --group-color: var(--stk-middle); --group-bar: var(--stk-middle-bar); }
.group.retail { --group-color: var(--stk-retail); --group-bar: var(--stk-retail-bar); }

.group-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
}

.group-name {
    flex: none;
    font-size: 13px;
    font-weight: 700;
    color: var(--group-color);
}

.group-range {
    flex: 1;
    min-width: 0;
    font-size: 11.5px;
    color: var(--stk-subtle);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.group-pct {
    flex: none;
    font-size: 18px;
    line-height: 1.1;
    font-weight: 700;
    color: var(--group-color);
    font-variant-numeric: tabular-nums;
}

.group-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 3px;
    font-size: 11.5px;
    color: var(--stk-muted);
    font-variant-numeric: tabular-nums;
}

/* 級距明細 */
.details {
    margin-top: 10px;
    border-top: 1px solid var(--stk-divider);
    padding-top: 8px;
}

.details > summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--stk-muted);
    padding: 2px 0;
    border-radius: 4px;
}

.details > summary:focus-visible {
    outline: 2px solid var(--stk-focus);
    outline-offset: 2px;
}

.level-table {
    width: 100%;
    margin-top: 6px;
    border-collapse: collapse;
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
}

.level-table th {
    padding: 4px 4px;
    font-weight: 600;
    color: var(--stk-subtle);
    text-align: right;
    border-bottom: 1px solid var(--stk-divider);
}

.level-table td {
    padding: 3px 4px;
    text-align: right;
    color: var(--stk-text);
    border-bottom: 1px solid #f1f5f9;
}

.level-table th:first-child,
.level-table td:first-child {
    text-align: left;
}

.level-table th:nth-child(2),
.level-table td:nth-child(2) {
    text-align: left;
}

.level-table tr.whale td:first-child { box-shadow: inset 3px 0 0 var(--stk-whale-bar); }
.level-table tr.middle td:first-child { box-shadow: inset 3px 0 0 var(--stk-middle-bar); }
.level-table tr.retail td:first-child { box-shadow: inset 3px 0 0 var(--stk-retail-bar); }

.level-table td:first-child {
    padding-left: 8px;
}

.level-table tfoot th,
.level-table tfoot td {
    padding: 4px 4px;
    font-weight: 700;
    border-bottom: 0;
    border-top: 1px solid var(--stk-divider);
}

.level-table tfoot th {
    padding-left: 8px;
    text-align: left;
    white-space: nowrap;
}

.level-table tr.group-total.whale { color: var(--stk-whale); }
.level-table tr.group-total.middle { color: var(--stk-middle); }
.level-table tr.group-total.retail { color: var(--stk-retail); }

.level-table tr.group-total th,
.level-table tr.group-total td {
    color: inherit;
}

.level-table tr.group-total td:nth-child(2) {
    font-weight: 400;
    color: var(--stk-subtle);
    white-space: nowrap;
}
.level-table tr.group-total.whale th { box-shadow: inset 3px 0 0 var(--stk-whale-bar); }
.level-table tr.group-total.middle th { box-shadow: inset 3px 0 0 var(--stk-middle-bar); }
.level-table tr.group-total.retail th { box-shadow: inset 3px 0 0 var(--stk-retail-bar); }

.table-note {
    margin: 6px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--stk-subtle);
}

/* 底部列 */
.footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 10px;
}

.foot-status {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 11px;
    color: var(--stk-subtle);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.actions {
    display: flex;
    flex: none;
    gap: 6px;
}

.text-btn {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--stk-control-border);
    border-radius: 7px;
    background: var(--stk-bg);
    color: var(--stk-muted);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
}

.text-btn:hover:not(:disabled) {
    background: var(--stk-surface);
    border-color: #475569;
}

.text-btn:active:not(:disabled) {
    transform: translateY(1px);
}

.text-btn:disabled {
    cursor: not-allowed;
    opacity: 0.55;
}

.text-btn:focus-visible {
    outline: 2px solid var(--stk-focus);
    outline-offset: 2px;
}

.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}

@media (prefers-reduced-motion: reduce) {
    .panel,
    .panel *,
    .panel *::before,
    .panel *::after {
        transition: none !important;
        animation: none !important;
    }
}

/* 面板寬度實際縮小 (視窗 < 336px) 時才改為單欄 */
@media (max-width: 335px) {
    .controls {
        grid-template-columns: 1fr;
    }
}

/* 列印 TDCC 頁面時不輸出面板 */
@media print {
    .panel {
        display: none !important;
    }
}
`;
