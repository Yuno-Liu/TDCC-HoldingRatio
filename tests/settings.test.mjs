import assert from "node:assert/strict";
import test from "node:test";
import { STORAGE_KEY } from "../dist-test/config/constants.js";
import {
    createChromeStore,
    createChromeSubscription,
    createMemoryStore,
    DEFAULT_SETTINGS,
    loadSettings,
    sanitizeSettings,
    saveSettings,
} from "../dist-test/core/settings.js";

test("sanitizeSettings: 無效或缺漏欄位回到預設值", () => {
    for (const raw of [undefined, null, 42, "x", [], {}]) {
        assert.deepEqual(sanitizeSettings(raw), { ...DEFAULT_SETTINGS });
    }

    assert.deepEqual(sanitizeSettings({
        retailLevel: "9",
        whaleLevel: null,
        collapsed: "yes",
        showDetails: 1,
        position: { left: "10", top: 20 },
    }), { ...DEFAULT_SETTINGS });
});

test("sanitizeSettings: 保留合法設定並修正衝突門檻與位置", () => {
    assert.deepEqual(sanitizeSettings({
        retailLevel: 8,
        whaleLevel: 12,
        collapsed: true,
        showDetails: true,
        position: { left: 100.4, top: 50.6 },
    }), { retailLevel: 8, whaleLevel: 12, collapsed: true, showDetails: true, position: { left: 100, top: 51 } });

    // 門檻衝突時保留大戶門檻
    const conflict = sanitizeSettings({ retailLevel: 13, whaleLevel: 11 });
    assert.equal(conflict.whaleLevel, 11);
    assert.equal(conflict.retailLevel, 10);

    assert.equal(sanitizeSettings({ position: { left: Number.NaN, top: 1 } }).position, null);
});

test("loadSettings / saveSettings: 儲存失敗時不拋出錯誤", async () => {
    const broken = {
        load: async () => {
            throw new Error("Extension context invalidated.");
        },
        save: async () => {
            throw new Error("Extension context invalidated.");
        },
    };

    assert.deepEqual(await loadSettings(broken), { ...DEFAULT_SETTINGS });
    await assert.doesNotReject(saveSettings(broken, { ...DEFAULT_SETTINGS }));
    assert.deepEqual(await loadSettings(null), { ...DEFAULT_SETTINGS });
    await assert.doesNotReject(saveSettings(null, { ...DEFAULT_SETTINGS }));
});

test("createMemoryStore: 讀寫往返", async () => {
    const store = createMemoryStore({ retailLevel: 3, whaleLevel: 10 });
    assert.equal((await loadSettings(store)).retailLevel, 3);

    await saveSettings(store, { ...DEFAULT_SETTINGS, whaleLevel: 12 });
    assert.equal(store.data.whaleLevel, 12);
});

test("chrome.storage 實作：讀寫指定鍵值並只轉發本擴充功能的 local 變更", async (t) => {
    const data = {};
    const listeners = new Set();
    globalThis.chrome = {
        storage: {
            local: {
                get: async (key) => ({ [key]: data[key] }),
                set: async (items) => Object.assign(data, items),
            },
            onChanged: {
                addListener: (fn) => listeners.add(fn),
                removeListener: (fn) => listeners.delete(fn),
            },
        },
    };
    t.after(() => {
        delete globalThis.chrome;
    });

    const store = createChromeStore();
    assert.ok(store);
    await store.save({ ...DEFAULT_SETTINGS, retailLevel: 5 });
    assert.equal(data[STORAGE_KEY].retailLevel, 5);
    assert.equal((await store.load()).retailLevel, 5);

    const received = [];
    const unsubscribe = createChromeSubscription()((raw) => received.push(raw));
    assert.equal(listeners.size, 1);

    for (const fn of listeners) {
        fn({ [STORAGE_KEY]: { newValue: { whaleLevel: 12 } } }, "local");
        fn({ [STORAGE_KEY]: { newValue: { whaleLevel: 13 } } }, "sync"); // 其他儲存區：忽略
        fn({ otherKey: { newValue: 1 } }, "local"); // 其他鍵值：忽略
    }

    assert.deepEqual(received, [{ whaleLevel: 12 }]);
    unsubscribe();
    assert.equal(listeners.size, 0);
});

test("chrome.storage 不存在或存取拋錯時回傳 null", (t) => {
    assert.equal(createChromeStore(), null);
    assert.equal(createChromeSubscription(), null);

    Object.defineProperty(globalThis, "chrome", {
        configurable: true,
        get() {
            return {
                get storage() {
                    throw new Error("Extension context invalidated.");
                },
            };
        },
    });
    t.after(() => {
        delete globalThis.chrome;
    });

    assert.equal(createChromeStore(), null);
    assert.equal(createChromeSubscription(), null);
});
