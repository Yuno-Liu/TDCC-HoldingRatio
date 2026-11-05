import { mountApp } from "./app.js";
import { createChromeStore, createChromeSubscription } from "./core/settings.js";

/**
 * Content Script 進入點
 *
 * 於 TDCC 集保戶股權分散表頁面掛載持股比例統計面板，
 * 並以 chrome.storage.local 保存使用者的門檻、收合狀態與面板位置
 * (TDCC 查詢為整頁重新載入，保存設定可避免每次查詢後都要重新選擇門檻)
 */
mountApp({
    store: createChromeStore(),
    subscribe: createChromeSubscription(),
});
