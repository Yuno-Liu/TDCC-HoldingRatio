import { CONFIG, HOST_ID } from "./config/constants.js";
import { calculateDistribution, normalizeThresholds } from "./core/calculator.js";
import {
    clampPercentage,
    formatAverageLots,
    formatHolders,
    formatInteger,
    formatLots,
    formatPercent,
    groupRangeLabel,
    groupShareRange,
    retailOptionLabel,
    retailShortLabel,
    whaleOptionLabel,
    whaleShortLabel,
} from "./core/format.js";
import { parseStockPage } from "./core/parser.js";
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, type SettingsStore } from "./core/settings.js";
import type { Distribution, GroupKey, PanelPosition, ParseResult, Settings, StockLevelData } from "./types/index.js";
import { createPanel, removeExistingPanel, type PanelElements } from "./ui/panel.js";

/** 族群顯示名稱 */
const GROUP_NAMES: Record<GroupKey, string> = {
    whale: "大戶",
    middle: "中實戶",
    retail: "散戶",
};

const GROUP_ORDER: readonly GroupKey[] = ["whale", "middle", "retail"];

/**
 * mountApp 選項 (皆可省略；測試時可注入替代實作)
 */
export interface AppOptions {
    /** 目標 Document (預設為全域 document) */
    doc?: Document;
    /** 設定儲存 (預設不保存；content script 會傳入 chrome.storage 實作) */
    store?: SettingsStore | null;
    /** 寫入剪貼簿的函式 (預設使用 navigator.clipboard) */
    clipboard?: (text: string) => Promise<void>;
    /** 跨分頁設定同步訂閱 (回傳取消訂閱函式) */
    subscribe?: ((listener: (raw: unknown) => void) => () => void) | null;
    /** DOM 變動後重新解析的延遲 (毫秒) */
    debounceMs?: number;
    /** 頁面持續變動時最長延遲 (毫秒) */
    maxWaitMs?: number;
    /** 讀取已保存設定的最長等待時間 (毫秒)，逾時先以預設設定顯示 */
    loadTimeoutMs?: number;
}

/**
 * 面板控制器
 */
export interface AppController {
    /** 面板元素 */
    readonly elements: PanelElements;
    /** 設定載入並完成首次渲染後 resolve */
    readonly ready: Promise<void>;
    /** 重新解析頁面；force 為 true 時即使資料未變也重新渲染 */
    refresh(force?: boolean): void;
    /** 目前設定 (副本) */
    getSettings(): Settings;
    /** 目前計算結果 */
    getDistribution(): Distribution | null;
    /** 目前解析結果 */
    getParseResult(): ParseResult | null;
    /** 累計渲染次數 (供測試驗證不會無限重繪) */
    getRenderCount(): number;
    /** 產生可複製的文字摘要 */
    getSummaryText(): string;
    /** 移除面板並釋放所有監聽器 */
    destroy(): void;
}

/** 僅在內容實際改變時寫入 textContent，避免不必要的 DOM 變動 */
function setText(node: Element, text: string): void {
    if (node.textContent !== text) {
        node.textContent = text;
    }
}

function setHidden(node: HTMLElement, hidden: boolean): void {
    if (node.hidden !== hidden) {
        node.hidden = hidden;
    }
}

function setAttr(node: Element, name: string, value: string): void {
    if (node.getAttribute(name) !== value) {
        node.setAttribute(name, value);
    }
}

/**
 * 建立預設的剪貼簿寫入函式
 */
function createDefaultClipboard(doc: Document): (text: string) => Promise<void> {
    return async (text: string) => {
        const clipboard = doc.defaultView?.navigator.clipboard;

        if (clipboard?.writeText) {
            await clipboard.writeText(text);
            return;
        }

        // 備援：舊式 execCommand 複製
        const textarea = doc.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        doc.body.appendChild(textarea);
        textarea.select();
        const ok = doc.execCommand?.("copy") ?? false;
        textarea.remove();

        if (!ok) {
            throw new Error("Clipboard is not available");
        }
    };
}

/**
 * 建立並掛載統計面板
 *
 * @param options - 選項
 * @returns 面板控制器；頁面沒有 body 或無法取得 window 時回傳 null
 */
export function mountApp(options: AppOptions = {}): AppController | null {
    const doc = options.doc ?? document;
    const view = doc.defaultView;

    if (!doc.body || !view) {
        return null;
    }

    // 使用目標 Document 所屬的 window (測試時為 jsdom window)
    const win = view as Window & typeof globalThis;

    const store = options.store ?? null;
    const writeClipboard = options.clipboard ?? createDefaultClipboard(doc);
    const debounceMs = options.debounceMs ?? CONFIG.refreshDebounceMs;
    const maxWaitMs = Math.max(options.maxWaitMs ?? CONFIG.refreshMaxWaitMs, debounceMs);

    removeExistingPanel(doc);
    const el = createPanel(doc);

    type Timer = ReturnType<typeof win.setTimeout>;
    let settings: Settings = { ...DEFAULT_SETTINGS };
    let parsed: ParseResult | null = null;
    let distribution: Distribution | null = null;
    let signature = "";
    let renderCount = 0;
    let destroyed = false;
    let settingsLoaded = false;
    let externalSettingsApplied = false;
    let localChangeBeforeLoad = false;
    let refreshTimer: Timer | undefined;
    let pendingSince: number | null = null;
    let hintTimer: Timer | undefined;
    const flashTimers = new Map<HTMLButtonElement, Timer>();
    /**
     * 使用者在各下拉選單「自己選擇」的門檻。門檻衝突時另一方只是暫時調整，
     * 衝突解除後會回到這裡記錄的值 (例如用方向鍵瀏覽大戶選項時，散戶不會被永久改掉)
     */
    const preferred = { retail: settings.retailLevel, whale: settings.whaleLevel };
    /** 目前已知存於 chrome.storage 的設定 (JSON)；相同內容不重複寫入 (chrome 對相同值不會發出 onChanged) */
    let lastStoredJson: string | null = null;
    /** 本實例寫入後尚未收到回音的設定，用來辨識 onChanged 事件是否為自己寫入所觸發 */
    let pendingEchoes: Array<{ json: string; at: number }> = [];
    const cleanups: Array<() => void> = [];

    const listen = <K extends string>(
        target: EventTarget,
        type: K,
        handler: (event: Event) => void,
        listenerOptions?: AddEventListenerOptions,
    ): void => {
        target.addEventListener(type, handler, listenerOptions);
        cleanups.push(() => target.removeEventListener(type, handler, listenerOptions));
    };

    /** 移除逾時仍未收到回音的紀錄 (例如寫入失敗)，避免殘留紀錄阻擋其他分頁的變更 */
    const prunePendingEchoes = (): void => {
        const now = Date.now();
        pendingEchoes = pendingEchoes.filter((entry) => now - entry.at < CONFIG.echoTimeoutMs);
    };

    const persist = (): void => {
        const snapshot = sanitizeSettings(settings);
        const json = JSON.stringify(snapshot);

        if (!settingsLoaded) {
            localChangeBeforeLoad = true;
        }

        if (!store || json === lastStoredJson) {
            return;
        }

        lastStoredJson = json;
        const tracked = Boolean(options.subscribe);

        if (tracked) {
            prunePendingEchoes();
            pendingEchoes.push({ json, at: Date.now() });
        }

        void saveSettings(store, snapshot).then((saved) => {
            if (!saved && tracked) {
                const index = pendingEchoes.findIndex((entry) => entry.json === json);
                if (index >= 0) {
                    pendingEchoes.splice(index, 1);
                }
            }
        });
    };

    const announce = (message: string): void => {
        // 先清空再寫入，確保相同訊息也會被螢幕閱讀器重新播報
        el.live.textContent = "";
        win.setTimeout(() => {
            if (!destroyed) {
                el.live.textContent = message;
            }
        }, 30);
    };

    /** 按鈕暫時顯示回饋文字 */
    const flashButton = (button: HTMLButtonElement, text: string): void => {
        const original = button.dataset.label ?? button.textContent ?? "";
        button.dataset.label = original;
        button.textContent = text;

        const previous = flashTimers.get(button);
        if (previous !== undefined) {
            win.clearTimeout(previous);
        }

        flashTimers.set(button, win.setTimeout(() => {
            flashTimers.delete(button);
            button.textContent = original;
        }, 1500));
    };

    // ───────────────────────── 位置 / 拖曳 ─────────────────────────

    /**
     * 將使用者保存的位置夾在可見範圍內
     *
     * - 水平：面板完整位於視窗內 (使用 clientWidth，不含垂直捲軸)
     * - 垂直：收合時標題列完整可見；展開時盡量讓整個面板可見，
     *   但內容很高 (例如展開級距明細) 時不強迫整個面板塞進視窗 —— 面板最多上移到預設位置，
     *   其餘內容於面板內捲動 (至少保留 minVisibleBodyPx 的內容高度)
     */
    const clampPosition = (position: PanelPosition): PanelPosition => {
        const margin = CONFIG.viewportMarginPx;
        const viewportWidth = doc.documentElement.clientWidth || win.innerWidth;
        const viewportHeight = doc.documentElement.clientHeight || win.innerHeight;
        const width = el.panel.offsetWidth || 320;
        const border = Math.max(0, el.panel.offsetHeight - el.panel.clientHeight);
        const headerHeight = (el.header.offsetHeight || 48) + border;
        const naturalHeight = headerHeight + (settings.collapsed ? 0 : el.body.scrollHeight);
        const requiredHeight = settings.collapsed
            ? naturalHeight
            : Math.min(naturalHeight, Math.max(headerHeight + CONFIG.minVisibleBodyPx, viewportHeight - CONFIG.defaultTopPx - margin));
        const height = Math.min(requiredHeight, viewportHeight - margin * 2);
        const maxLeft = Math.max(margin, viewportWidth - width - margin);
        const maxTop = Math.max(margin, viewportHeight - height - margin);

        return {
            left: Math.round(Math.min(Math.max(position.left, margin), maxLeft)),
            top: Math.round(Math.min(Math.max(position.top, margin), maxTop)),
        };
    };

    /** 僅在值改變時寫入樣式 */
    const setStyle = (name: string, value: string | null): void => {
        const style = el.panel.style;

        if (value === null) {
            if (style.getPropertyValue(name)) {
                style.removeProperty(name);
            }
        } else if (style.getPropertyValue(name) !== value) {
            style.setProperty(name, value);
        }
    };

    /** 有保存位置時，依目前內容高度重新夾住 (不改變保存的值) */
    const reclampPosition = (): void => {
        if (settings.position) {
            applyPosition(settings.position);
        }
    };

    const applyPosition = (position: PanelPosition | null): void => {
        if (!position) {
            for (const name of ["left", "top", "right", "max-height"]) {
                setStyle(name, null);
            }
            return;
        }

        const clamped = clampPosition(position);
        setStyle("left", `${clamped.left}px`);
        setStyle("top", `${clamped.top}px`);
        setStyle("right", "auto");
        // 依實際位置限制高度，確保在縮放或小視窗時內容仍可捲動檢視
        setStyle("max-height", `calc(100vh - ${clamped.top + CONFIG.viewportMarginPx}px)`);
    };

    // ───────────────────────── 渲染 ─────────────────────────

    /**
     * 證券資訊文字
     *
     * @param compactDate - 是否將「115年10月30日」縮寫為「115/10/30」(收合時標題空間較小)
     */
    const metaLine = (result: ParseResult | null, compactDate = false): string => {
        if (!result) {
            return "等待 TDCC 資料…";
        }

        const { stockNo, stockName } = result.meta;
        const dataDate = compactDate
            ? result.meta.dataDate?.replace(/\s/g, "").replace(/^(\d+)年(\d+)月(\d+)日$/, "$1/$2/$3") ?? null
            : result.meta.dataDate;
        const stock = [stockNo, stockName].filter(Boolean).join(" ");
        const parts = [stock, dataDate].filter(Boolean);

        if (result.status === "no-table") {
            return "請輸入證券代號查詢";
        }

        if (result.status === "no-data") {
            return stock ? `${stock} · 查無資料` : "查無資料";
        }

        return parts.length > 0 ? parts.join(" · ") : "資料已同步";
    };

    /**
     * 標題列：
     * - 展開時：「持股比例統計」/ 證券資訊
     * - 收合時：證券資訊 / 含門檻定義的摘要 (例如「千張大戶 84.39% · ≤100張散戶 10.29%」)
     */
    const renderHeader = (): void => {
        if (!settings.collapsed || !distribution || !parsed) {
            setText(el.title, "持股比例統計");
            setText(el.subtitle, metaLine(parsed));
            setAttr(el.title, "title", "持股比例統計");
            return;
        }

        setText(el.title, metaLine(parsed, true));
        // 名稱過長被截斷時，滑鼠移上仍可看到完整資訊
        setAttr(el.title, "title", metaLine(parsed));
        setText(el.subtitle, [
            `${whaleShortLabel(distribution.whaleLevel)} ${formatPercent(distribution.whale.percent)}`,
            `${retailShortLabel(distribution.retailLevel)} ${formatPercent(distribution.retail.percent)}`,
        ].join(" · "));
    };

    const levelRangeText = (range: [number, number] | null): string => {
        if (!range) {
            return "";
        }

        return range[0] === range[1] ? `${range[0]} 級` : `${range[0]}–${range[1]} 級`;
    };

    const levelGroup = (level: number, result: Distribution): GroupKey => {
        if (level >= result.whaleLevel) {
            return "whale";
        }

        return level <= result.retailLevel ? "retail" : "middle";
    };

    const renderLevelRows = (result: Distribution, levels: readonly StockLevelData[]): void => {
        const byLevel = new Map(levels.map((item) => [item.level, item]));

        el.levelRows.forEach((rowElements, index) => {
            const level = index + CONFIG.minLevel;
            const item = byLevel.get(level);
            const percent = item?.percent ?? (item?.shares != null && result.totalShares
                ? (item.shares / result.totalShares) * 100
                : null);

            setAttr(rowElements.row, "class", levelGroup(level, result));
            setText(rowElements.holders, item ? formatInteger(item.holders) : "--");
            setText(rowElements.percent, formatPercent(percent));
        });
    };

    const render = (): void => {
        renderCount += 1;
        const result = parsed;

        if (!result || result.status !== "ok") {
            distribution = null;
            setHidden(el.results, true);
            setHidden(el.notice, false);
            el.notice.classList.remove("is-warning");
            setText(el.notice, result?.status === "no-data"
                ? "此證券於所選資料日期查無股權分散資料，請確認證券代號或改選其他日期。"
                : "請於 TDCC 頁面輸入證券代號並按「查詢」，結果出現後會自動計算。");
            setHidden(el.footer, true);
            el.copyButton.disabled = true;
            renderHeader();
            reclampPosition();
            return;
        }

        const next = calculateDistribution(result, settings.retailLevel, settings.whaleLevel);
        distribution = next;

        // 資料完整性提示
        const warnings = [...result.warnings];
        if (next.levelCount < CONFIG.maxLevel) {
            warnings.unshift(`僅解析到 ${next.levelCount}/${CONFIG.maxLevel} 個級距，結果可能不完整。`);
        }

        // 差異數調整明顯時 (例如部分 ETF)，各族群比例加總會偏離 100%，主動說明避免誤會
        const adjustmentShares = result.adjustment?.shares ?? 0;
        if (next.method === "shares" && next.totalShares) {
            const adjustmentPercent = (adjustmentShares / next.totalShares) * 100;

            if (Math.abs(adjustmentPercent) >= CONFIG.adjustmentNoticePercent) {
                const groupSum = next.whale.percent + next.middle.percent + next.retail.percent;
                warnings.push(`本表「差異數調整」為 ${formatPercent(adjustmentPercent)}，比例以合計股數為分母（與 TDCC 相同），三族群加總為 ${formatPercent(groupSum)}。`);
            }
        }
        setHidden(el.notice, warnings.length === 0);
        el.notice.classList.toggle("is-warning", warnings.length > 0);
        setText(el.notice, warnings.join(" "));

        setHidden(el.results, false);

        for (const key of GROUP_ORDER) {
            const group = next[key];
            const view = el.groups[key];

            setHidden(view.item, key === "middle" && group.range === null);
            setText(view.range, groupRangeLabel(group.range));
            setAttr(view.range, "title", groupShareRange(group.range));
            setText(view.percent, formatPercent(group.percent));
            setText(view.holders, `${formatHolders(group.holders)}（占股東 ${formatPercent(group.holderRatio)}）`);
            setText(view.lots, group.shares === null ? "" : formatLots(group.shares));
            setAttr(view.lots, "title", group.shares !== null && group.holders > 0
                ? `合計持有張數，平均每人約 ${formatAverageLots(group.shares, group.holders)}`
                : "合計持有張數 (1 張 = 1,000 股)");

            const width = `${clampPercentage(group.percent)}%`;
            if (view.bar.style.width !== width) {
                view.bar.style.width = width;
            }
        }

        setAttr(el.bar, "aria-label", GROUP_ORDER
            .filter((key) => key !== "middle" || next.middle.range !== null)
            .map((key) => `${GROUP_NAMES[key]} ${formatPercent(next[key].percent)}`)
            .join("、"));

        renderLevelRows(next, result.levels);

        // 明細表底部的族群合計：與上方卡片完全一致 (依股數精算)
        for (const key of GROUP_ORDER) {
            const group = next[key];
            const view = el.groupTotalRows[key];

            setHidden(view.row, key === "middle" && group.range === null);
            setText(view.range, levelRangeText(group.range));
            setText(view.holders, formatInteger(group.holders));
            setText(view.percent, formatPercent(group.percent));
        }

        setHidden(el.footer, false);
        setText(el.footStatus, `總股東 ${formatInteger(next.totalHolders)} 人${next.method === "shares" ? "" : " · 依比例欄加總"}`);
        setAttr(el.footStatus, "title", next.method === "shares"
            ? "族群比例 = 族群持股股數 ÷ 合計股數。TDCC 比例欄為無條件捨去至小數第 2 位，直接加總會低估，因此改以股數精算。"
            : "股數欄位不完整，改為加總 TDCC 比例欄位 (無條件捨去值，可能略為低估)。");
        el.copyButton.disabled = false;
        renderHeader();
        // 內容高度可能改變 (例如頁面載入後才顯示結果)，依新高度重新夾住保存的位置
        reclampPosition();
    };

    const getSummaryText = (): string => {
        if (!distribution || !parsed) {
            return "";
        }

        const { stockNo, stockName, dataDate } = parsed.meta;
        const title = ["TDCC 集保股權分散", [stockNo, stockName].filter(Boolean).join(" "), dataDate ? `資料日期 ${dataDate}` : ""]
            .filter(Boolean)
            .join("｜");
        const lines = GROUP_ORDER
            .filter((key) => key !== "middle" || distribution?.middle.range !== null)
            .map((key) => {
                const group = (distribution as Distribution)[key];
                return `${GROUP_NAMES[key]}（${groupRangeLabel(group.range)}）：${formatPercent(group.percent)}｜${formatHolders(group.holders)}`;
            });

        return [
            title,
            ...lines,
            `總股東 ${formatHolders(distribution.totalHolders)}｜${distribution.method === "shares" ? "依股數計算" : "依比例欄加總"}`,
        ].join("\n");
    };

    // ───────────────────────── 狀態套用 ─────────────────────────

    const setCollapsed = (collapsed: boolean): void => {
        settings.collapsed = collapsed;
        el.panel.classList.toggle("is-collapsed", collapsed);
        setHidden(el.body, collapsed);
        setAttr(el.toggleButton, "aria-expanded", String(!collapsed));
        setAttr(el.toggleButton, "aria-label", collapsed ? "展開面板" : "收合面板");
        renderHeader();

        // 高度改變後重新夾住位置 (例如貼近底部時展開，需往上移才能看到內容)
        reclampPosition();
    };

    const syncControls = (): void => {
        // 所有選項皆可選；衝突時由 onThresholdChange 自動調整另一個門檻
        el.whaleSelect.value = String(settings.whaleLevel);
        el.retailSelect.value = String(settings.retailLevel);

        if (el.details.open !== settings.showDetails) {
            el.details.open = settings.showDetails;
        }
    };

    const applySettings = (next: Settings): void => {
        settings = { ...next };
        preferred.retail = settings.retailLevel;
        preferred.whale = settings.whaleLevel;
        syncControls();
        setCollapsed(settings.collapsed);
        applyPosition(settings.position);
        render();
    };

    // ───────────────────────── 資料更新 ─────────────────────────

    const refresh = (force = false): void => {
        if (destroyed) {
            return;
        }

        if (refreshTimer !== undefined) {
            win.clearTimeout(refreshTimer);
            refreshTimer = undefined;
        }

        pendingSince = null;
        const next = parseStockPage(doc);
        const nextSignature = JSON.stringify(next);

        // 資料未變動時不重繪 (避免無謂的 DOM 寫入)
        if (!force && nextSignature === signature) {
            return;
        }

        signature = nextSignature;
        parsed = next;
        render();
    };

    /**
     * 去抖動排程：連續變動合併為一次解析；但頁面持續變動 (例如輪播、計時器) 時，
     * 最多延遲 maxWaitMs 仍會強制解析一次，避免表格更新永遠不被處理
     */
    const scheduleRefresh = (): void => {
        const now = Date.now();
        pendingSince ??= now;

        if (refreshTimer !== undefined) {
            win.clearTimeout(refreshTimer);
        }

        const wait = Math.max(0, Math.min(debounceMs, pendingSince + maxWaitMs - now));
        refreshTimer = win.setTimeout(() => {
            refreshTimer = undefined;
            refresh();
        }, wait);
    };

    /** 是否僅為本面板宿主元素自身的插入 / 移除 */
    const isOwnMutation = (record: MutationRecord): boolean => {
        if (record.target === el.host) {
            return true;
        }

        if (record.type !== "childList") {
            return false;
        }

        const changed = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
        return changed.length > 0 && changed.every((node) => node === el.host);
    };

    const observer = new win.MutationObserver((records) => {
        if (destroyed) {
            return;
        }

        if (!el.host.isConnected) {
            const current = doc.getElementById(HOST_ID);

            if (current && current !== el.host) {
                // 已有較新的實例接手 (例如擴充功能重新載入後重新注入)，釋放本實例
                destroy();
                return;
            }

            // 宿主被頁面腳本移除，重新掛回
            doc.body?.appendChild(el.host);
        }

        if (records.every(isOwnMutation)) {
            return;
        }

        scheduleRefresh();
    });

    // ───────────────────────── 事件綁定 ─────────────────────────

    const showHint = (message: string): void => {
        setText(el.hint, message);
        setHidden(el.hint, false);

        if (hintTimer !== undefined) {
            win.clearTimeout(hintTimer);
        }

        hintTimer = win.setTimeout(() => {
            hintTimer = undefined;
            setHidden(el.hint, true);
        }, CONFIG.hintDurationMs);
    };

    /**
     * 門檻變更：所有選項皆可選。若與另一門檻重疊，保留剛變更的一方，另一方「暫時」讓位；
     * 衝突解除後自動回到使用者原本選擇的值。
     *
     * 例：散戶 ≤ 100 張時把大戶改為 > 50 張 → 散戶暫時變成 ≤ 50 張；
     *     大戶再改回 > 1,000 張 → 散戶自動恢復 ≤ 100 張
     */
    const onThresholdChange = (changed: "retail" | "whale"): void => {
        let retail: number;
        let whale: number;

        if (changed === "whale") {
            preferred.whale = Number(el.whaleSelect.value);
            whale = preferred.whale;
            retail = Math.min(preferred.retail, whale - 1);
        } else {
            preferred.retail = Number(el.retailSelect.value);
            retail = preferred.retail;
            whale = Math.max(preferred.whale, retail + 1);
        }

        const thresholds = normalizeThresholds(retail, whale, changed);
        settings.retailLevel = thresholds.retailLevel;
        settings.whaleLevel = thresholds.whaleLevel;
        syncControls();
        render();
        persist();

        let adjustment = "";
        if (changed === "whale" && thresholds.retailLevel !== preferred.retail) {
            adjustment = `散戶門檻暫時調整為「${retailOptionLabel(thresholds.retailLevel)}」以避免與大戶重疊，大戶門檻調回後自動還原。`;
        } else if (changed === "retail" && thresholds.whaleLevel !== preferred.whale) {
            adjustment = `大戶門檻暫時調整為「${whaleOptionLabel(thresholds.whaleLevel)}」以避免與散戶重疊，散戶門檻調回後自動還原。`;
        }

        if (adjustment) {
            showHint(adjustment);
        } else {
            setHidden(el.hint, true);
        }

        const result = distribution
            ? `大戶 ${formatPercent(distribution.whale.percent)}，散戶 ${formatPercent(distribution.retail.percent)}`
            : "";

        if (adjustment || result) {
            announce(`${adjustment}${result}`);
        }
    };

    listen(el.whaleSelect, "change", () => onThresholdChange("whale"));
    listen(el.retailSelect, "change", () => onThresholdChange("retail"));

    let drag: { pointerId: number; startX: number; startY: number; left: number; top: number; moved: boolean } | null = null;
    let suppressClick = false;

    listen(el.header, "pointerdown", (event) => {
        const pointer = event as PointerEvent;

        if (pointer.button !== 0 || (pointer.target as Element | null)?.closest?.("button")) {
            return;
        }

        const rect = el.panel.getBoundingClientRect();
        drag = { pointerId: pointer.pointerId, startX: pointer.clientX, startY: pointer.clientY, left: rect.left, top: rect.top, moved: false };
        el.header.setPointerCapture?.(pointer.pointerId);
    });

    listen(el.header, "pointermove", (event) => {
        const pointer = event as PointerEvent;

        if (!drag || pointer.pointerId !== drag.pointerId) {
            return;
        }

        const dx = pointer.clientX - drag.startX;
        const dy = pointer.clientY - drag.startY;

        if (!drag.moved && Math.hypot(dx, dy) < CONFIG.dragThresholdPx) {
            return;
        }

        drag.moved = true;
        el.panel.classList.add("is-dragging");
        settings.position = clampPosition({ left: drag.left + dx, top: drag.top + dy });
        applyPosition(settings.position);
    });

    const endDrag = (event: Event): void => {
        const pointer = event as PointerEvent;

        if (!drag || pointer.pointerId !== drag.pointerId) {
            return;
        }

        const moved = drag.moved;
        drag = null;
        el.panel.classList.remove("is-dragging");

        if (el.header.hasPointerCapture?.(pointer.pointerId)) {
            el.header.releasePointerCapture(pointer.pointerId);
        }

        if (moved) {
            // 拖曳結束後緊接的 click 不應觸發收合
            suppressClick = true;
            win.setTimeout(() => {
                suppressClick = false;
            }, 0);
            persist();
        }
    };

    listen(el.header, "pointerup", endDrag);
    listen(el.header, "pointercancel", endDrag);

    listen(el.header, "click", () => {
        if (suppressClick) {
            suppressClick = false;
            return;
        }

        setCollapsed(!settings.collapsed);
        persist();
    });

    // Esc：焦點在面板內時收合面板 (不攔截頁面其他區域的 Esc，例如 TDCC 自動完成選單)
    listen(el.root, "keydown", (event) => {
        const keyboard = event as KeyboardEvent;

        if (keyboard.key === "Escape" && !keyboard.isComposing && !keyboard.defaultPrevented && !settings.collapsed) {
            event.stopPropagation();
            setCollapsed(true);
            persist();
            el.toggleButton.focus();
        }
    });

    listen(el.details, "toggle", () => {
        if (settings.showDetails !== el.details.open) {
            settings.showDetails = el.details.open;
            persist();
        }

        // 展開明細後內容變高，必要時上移以保持可見
        reclampPosition();
    });

    listen(el.refreshButton, "click", () => {
        refresh(true);
        flashButton(el.refreshButton, "已更新");
        announce(distribution
            ? `已重新計算：大戶 ${formatPercent(distribution.whale.percent)}，散戶 ${formatPercent(distribution.retail.percent)}`
            : "已重新計算，尚未取得資料");
    });

    listen(el.copyButton, "click", () => {
        const text = getSummaryText();

        if (!text) {
            return;
        }

        writeClipboard(text).then(
            () => {
                if (!destroyed) {
                    flashButton(el.copyButton, "已複製 ✓");
                    announce("已複製統計結果");
                }
            },
            () => {
                if (!destroyed) {
                    flashButton(el.copyButton, "複製失敗");
                    announce("複製失敗");
                }
            },
        );
    });

    listen(win, "resize", reclampPosition);

    /**
     * 跨分頁同步 (chrome.storage.onChanged，事件依寫入順序送達)：
     * - 自己寫入的回音：忽略
     * - 本實例仍有尚未收到回音的寫入：代表其他分頁的這筆變更較早寫入、稍後會被本實例的寫入覆蓋，忽略
     * - 其他情況：套用其他分頁的新設定
     */
    const unsubscribe = options.subscribe?.((raw) => {
        if (destroyed) {
            return;
        }

        const next = sanitizeSettings(raw);
        const json = JSON.stringify(next);
        lastStoredJson = json;
        prunePendingEchoes();

        const echoIndex = pendingEchoes.findIndex((entry) => entry.json === json);
        if (echoIndex >= 0) {
            pendingEchoes.splice(echoIndex, 1);
            return;
        }

        if (pendingEchoes.length > 0) {
            return;
        }

        if (json !== JSON.stringify(sanitizeSettings(settings))) {
            externalSettingsApplied = true;
            applySettings(next);
        }
    });

    if (unsubscribe) {
        cleanups.push(unsubscribe);
    }

    // ───────────────────────── 掛載 ─────────────────────────

    // 設定載入前先隱藏，避免預設值與已保存設定之間的閃爍
    el.panel.style.visibility = "hidden";
    syncControls();
    doc.body.appendChild(el.host);
    observer.observe(doc.body, { childList: true, subtree: true, characterData: true });

    const reveal = (): void => {
        el.panel.style.removeProperty("visibility");
    };

    // 保險：儲存空間異常未回應時，仍在短時間後以預設設定顯示面板
    const revealTimer = win.setTimeout(() => {
        if (!destroyed && parsed === null) {
            refresh(true);
        }
        reveal();
    }, options.loadTimeoutMs ?? CONFIG.settingsLoadTimeoutMs);

    const ready = loadSettings(store)
        .then((loaded) => {
            if (destroyed) {
                return;
            }

            settingsLoaded = true;

            if (!externalSettingsApplied) {
                lastStoredJson = JSON.stringify(loaded);
            }

            // 載入期間若已套用其他分頁同步來的較新設定，或使用者已在逾時顯示後自行調整，
            // 不以較舊的讀取結果覆蓋
            if (!externalSettingsApplied && !localChangeBeforeLoad) {
                settings = loaded;
                preferred.retail = settings.retailLevel;
                preferred.whale = settings.whaleLevel;
            }

            syncControls();
            setCollapsed(settings.collapsed);
            // refresh → render 結束時會依實際內容高度夾住保存的位置
            refresh(true);
        })
        .finally(() => {
            win.clearTimeout(revealTimer);
            reveal();
        });

    function destroy(): void {
        if (destroyed) {
            return;
        }

        destroyed = true;
        observer.disconnect();
        win.clearTimeout(revealTimer);

        if (refreshTimer !== undefined) {
            win.clearTimeout(refreshTimer);
        }

        if (hintTimer !== undefined) {
            win.clearTimeout(hintTimer);
        }

        flashTimers.forEach((timer) => win.clearTimeout(timer));
        flashTimers.clear();
        cleanups.splice(0).forEach((cleanup) => cleanup());

        if (doc.getElementById(HOST_ID) === el.host) {
            el.host.remove();
        }
    }

    return {
        elements: el,
        ready,
        refresh,
        getSettings: () => ({ ...settings, position: settings.position ? { ...settings.position } : null }),
        getDistribution: () => distribution,
        getParseResult: () => parsed,
        getRenderCount: () => renderCount,
        getSummaryText,
        destroy,
    };
}
