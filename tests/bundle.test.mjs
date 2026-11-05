/**
 * 發佈產物驗證：直接執行 esbuild 打包後的 dist/content.js (實際載入 Chrome 的檔案)
 * 需先執行 npm run build (npm test 會自動執行)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDom, readFixture, waitFor } from "./helpers/tdcc.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "dist", "content.js");
const STORAGE_KEY = "tdccHoldingRatio.settings";

function createFakeChrome(initial) {
    const data = { ...initial };
    const writes = [];
    const listeners = new Set();

    return {
        data,
        writes,
        listeners,
        api: {
            storage: {
                local: {
                    get: async (key) => ({ [key]: data[key] }),
                    set: async (items) => {
                        writes.push(structuredClone(items));
                        Object.assign(data, items);
                        for (const listener of listeners) {
                            listener({ [STORAGE_KEY]: { newValue: items[STORAGE_KEY] } }, "local");
                        }
                    },
                },
                onChanged: {
                    addListener: (fn) => listeners.add(fn),
                    removeListener: (fn) => listeners.delete(fn),
                },
            },
        },
    };
}

async function runBundle(t, html, chromeApi) {
    assert.ok(fs.existsSync(bundlePath), "找不到 dist/content.js，請先執行 npm run build");
    const dom = createDom(html);

    if (chromeApi) {
        dom.window.chrome = chromeApi;
    }

    dom.window.eval(fs.readFileSync(bundlePath, "utf8"));
    t.after(() => dom.window.close());
    const host = dom.window.document.getElementById("stk-helper-root");
    assert.ok(host?.shadowRoot, "面板應已掛載");
    // 等待設定載入並完成首次渲染 (面板由隱藏轉為顯示)
    const panel = host.shadowRoot.querySelector('[data-ref="panel"]');
    await waitFor(() => panel.style.visibility === "");
    const ref = (name) => host.shadowRoot.querySelector(`[data-ref="${name}"]`);
    return { dom, window: dom.window, host, ref };
}

test("manifest：Manifest V3、只在 TDCC 查詢頁執行、宣告 storage 權限", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.version, pkg.version, "manifest 與 package.json 版本應一致");
    assert.deepEqual(manifest.permissions, ["storage"]);
    assert.equal(manifest.host_permissions, undefined, "content script 不需要額外 host 權限");
    assert.equal(manifest.content_scripts.length, 1);
    assert.deepEqual(manifest.content_scripts[0].matches, ["https://www.tdcc.com.tw/portal/zh/smWeb/qryStock*"]);
    assert.deepEqual(manifest.content_scripts[0].js, ["content.js"]);
    assert.equal(manifest.content_scripts[0].run_at, "document_idle");
});

test("bundle：在真實 TDCC 頁面上渲染，並套用 chrome.storage 中保存的設定", async (t) => {
    const fake = createFakeChrome({ [STORAGE_KEY]: { retailLevel: 8, whaleLevel: 12, collapsed: false, showDetails: true } });
    const { ref, window } = await runBundle(t, readFixture("tdcc-2330-20261022.html"), fake.api);

    assert.equal(ref("subtitle").textContent, "2330 台積電 · 115年10月22日");
    assert.equal(ref("whale-select").value, "12");
    assert.equal(ref("retail-select").value, "8");
    assert.equal(ref("whale-pct").textContent, "87.19%");
    assert.equal(ref("retail-pct").textContent, "9.13%");
    assert.equal(ref("details").open, true);

    // 變更門檻後寫回 chrome.storage.local
    const select = ref("whale-select");
    select.value = "15";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await waitFor(() => fake.writes.at(-1)?.[STORAGE_KEY]?.whaleLevel === 15);

    assert.equal(ref("whale-pct").textContent, "84.42%");
    assert.equal(fake.writes.at(-1)[STORAGE_KEY].whaleLevel, 15);
    assert.equal(fake.listeners.size, 1, "應訂閱 chrome.storage.onChanged");
});

test("bundle：沒有 chrome API (非擴充功能環境) 時仍可正常運作", async (t) => {
    const { ref } = await runBundle(t, readFixture("tdcc-2330-20261022.html"));

    assert.equal(ref("whale-pct").textContent, "84.42%");
    assert.equal(ref("retail-pct").textContent, "10.24%");
});

test("bundle：查無資料頁面", async (t) => {
    const { ref } = await runBundle(t, readFixture("tdcc-no-data.html"), createFakeChrome({}).api);

    assert.equal(ref("results").hidden, true);
    assert.equal(ref("subtitle").textContent, "2330 · 查無資料");
});
