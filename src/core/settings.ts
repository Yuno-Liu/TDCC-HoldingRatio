import { CONFIG, STORAGE_KEY } from "../config/constants.js";
import type { PanelPosition, Settings } from "../types/index.js";
import { normalizeThresholds } from "./calculator.js";

/**
 * 設定儲存介面 (可替換為記憶體實作以便測試)
 */
export interface SettingsStore {
    load(): Promise<unknown>;
    save(settings: Settings): Promise<void>;
}

/** 預設設定 */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
    retailLevel: CONFIG.defaultRetailLevel,
    whaleLevel: CONFIG.defaultWhaleLevel,
    collapsed: false,
    showDetails: false,
    position: null,
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function sanitizePosition(value: unknown): PanelPosition | null {
    if (!isRecord(value)) {
        return null;
    }

    const { left, top } = value;

    if (typeof left !== "number" || typeof top !== "number" || !Number.isFinite(left) || !Number.isFinite(top)) {
        return null;
    }

    return { left: Math.round(left), top: Math.round(top) };
}

/**
 * 驗證並修正從儲存空間讀回的設定 (防止舊版本或損毀資料造成錯誤)
 *
 * @param raw - 任意輸入
 * @returns 合法的完整設定
 */
export function sanitizeSettings(raw: unknown): Settings {
    const source = isRecord(raw) ? raw : {};
    const retail = typeof source.retailLevel === "number" ? source.retailLevel : DEFAULT_SETTINGS.retailLevel;
    const whale = typeof source.whaleLevel === "number" ? source.whaleLevel : DEFAULT_SETTINGS.whaleLevel;
    const thresholds = normalizeThresholds(retail, whale);

    return {
        retailLevel: thresholds.retailLevel,
        whaleLevel: thresholds.whaleLevel,
        collapsed: typeof source.collapsed === "boolean" ? source.collapsed : DEFAULT_SETTINGS.collapsed,
        showDetails: typeof source.showDetails === "boolean" ? source.showDetails : DEFAULT_SETTINGS.showDetails,
        position: sanitizePosition(source.position),
    };
}

/**
 * 建立以 chrome.storage.local 為後端的設定儲存
 * (需 manifest 宣告 "storage" 權限；不在擴充功能環境時回傳 null)
 */
export function createChromeStore(): SettingsStore | null {
    let storage: chrome.storage.LocalStorageArea | undefined;

    try {
        storage = typeof chrome !== "undefined" ? chrome.storage?.local : undefined;
    } catch {
        storage = undefined;
    }

    if (!storage) {
        return null;
    }

    return {
        async load() {
            const result = await storage.get(STORAGE_KEY);
            return result?.[STORAGE_KEY];
        },
        async save(settings) {
            await storage.set({ [STORAGE_KEY]: settings });
        },
    };
}

/**
 * 建立 chrome.storage 變更訂閱 (多個 TDCC 分頁之間同步門檻設定)
 * 不在擴充功能環境時回傳 null
 */
export function createChromeSubscription(): ((listener: (raw: unknown) => void) => () => void) | null {
    let onChanged: typeof chrome.storage.onChanged | undefined;

    try {
        onChanged = typeof chrome !== "undefined" ? chrome.storage?.onChanged : undefined;
    } catch {
        onChanged = undefined;
    }

    if (!onChanged) {
        return null;
    }

    const event = onChanged;

    return (listener) => {
        const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
            const change = changes[STORAGE_KEY];

            if (areaName === "local" && change && "newValue" in change) {
                listener(change.newValue);
            }
        };

        event.addListener(handler);

        return () => {
            try {
                event.removeListener(handler);
            } catch {
                // 擴充功能 context 失效時忽略
            }
        };
    };
}

/**
 * 建立記憶體設定儲存 (用於測試或非擴充功能環境)
 *
 * @param initial - 初始內容
 */
export function createMemoryStore(initial?: unknown): SettingsStore & { readonly data: unknown } {
    let data: unknown = initial;

    return {
        get data() {
            return data;
        },
        async load() {
            return data;
        },
        async save(settings) {
            data = { ...settings };
        },
    };
}

/**
 * 安全地讀取設定：任何錯誤 (例如擴充功能重新載入後 context 失效) 都會回到預設值
 */
export async function loadSettings(store: SettingsStore | null): Promise<Settings> {
    if (!store) {
        return { ...DEFAULT_SETTINGS };
    }

    try {
        return sanitizeSettings(await store.load());
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * 安全地保存設定：失敗時不拋出錯誤 (不影響面板功能)
 *
 * @returns 是否成功寫入
 */
export async function saveSettings(store: SettingsStore | null, settings: Settings): Promise<boolean> {
    if (!store) {
        return false;
    }

    try {
        await store.save(settings);
        return true;
    } catch {
        // 儲存失敗不影響計算功能
        return false;
    }
}
