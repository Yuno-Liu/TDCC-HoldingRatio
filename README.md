# 📊 TDCC 集保股權分散統計工具 (TDCC-HoldingRatio)

[![GitHub License](https://img.shields.io/github/license/Yuno-Liu/TDCC-HoldingRatio)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/Tests-Passing-brightgreen?logo=node.js&logoColor=white)](tests/)

一個為台股投資人設計的 Chrome 擴充功能（Manifest V3 + TypeScript），專用於 [臺灣集中保管結算所 (TDCC) 集保戶股權分散表](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock) 查詢頁面。  
自動解析個股 15 個持股級距數據，即時動態計算散戶與千張大戶持股比例，並具備直觀的百分比視覺進度條。

---

## ✨ 核心特色與功能

- 🎯 **散戶與大戶持股比例自動計算**：
  - 自動匯總 1~15 級距的股數與人數。
  - 精準計算自訂門檻之散戶持股比例與大戶持股比例。
- ⚙️ **彈性自訂判定門檻**：
  - 散戶門檻自由選取（例如：`≤ 10 張`、`≤ 50 張`、`≤ 100 張` 等）。
  - 大戶門檻自由選取（例如：`≥ 400 張`、`≥ 800 張`、`≥ 1000 張 (千張大戶)` 等）。
  - 調整門檻下拉選單即刻動態重算，無需重載網頁。
- 📈 **視覺化雙色進度條**：直觀顯示散戶與大戶持股百分比對比。
- 🔄 **MutationObserver 動態監聽**：當使用者在 TDCC 頁面切換日期或查詢不同股票代號時，自動偵測表格變更並重新計算。
- ⌨️ **便捷鍵盤與收合操作**：
  - 按下鍵盤 `ESC` 鍵可快速收合或展開統計浮動面板。
  - 提供「重新計算」與「收合/展開」手動控制按鈕。

---

## 🚀 安裝說明

### 載入未封裝項目（開發者模式）

1. 複製專案並安裝相依套件：
   ```bash
   git clone https://github.com/Yuno-Liu/TDCC-HoldingRatio.git
   cd TDCC-HoldingRatio
   npm install
   npm run build
   ```
2. 編譯後的檔案將生成於 `dist/` 目錄中。
3. 開啟 Chrome 瀏覽器，前往 `chrome://extensions/`。
4. 開啟右上角的「**開發人員模式**」。
5. 點擊「**載入未封裝項目**」，選取本專案的 `dist/` 目錄。
6. 前往 [TDCC 集保戶股權分散表查詢頁面](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock) 進行測試。

---

## 📖 使用方式

1. 進入臺灣集中保管結算所的「集保戶股權分散表」查詢頁面。
2. 輸入股票代號（例如：`2330`）並查詢。
3. 頁面右下角會自動浮現「**TDCC 持股比例統計面板**」。
4. 於面板中的下拉選單選擇定義門檻：
   - **散戶門檻**：預設為 `≤ 50,000 股 (50張)`
   - **大戶門檻**：預設為 `≥ 1,000,001 股 (千張大戶)`
5. 面板將即時顯示計算出之持股人數、持有總股數與佔集保總股數百分比。

---

## 🛠️ 開發與測試

```bash
# 安裝相依套件
npm install

# 執行單元測試
npm test

# 編譯生產版本（產出 dist/）
npm run build

# 開發監聽模式（程式碼變更時即時打包）
npm run watch

# 執行 TypeScript 靜態型別檢查
npm run typecheck

# 清除構建暫存
npm run clean
```

---

## 📂 專案結構

```
TDCC-HoldingRatio/
├── src/
│   ├── content.ts              # Content Script 主入口
│   ├── config/
│   │   └── constants.ts        # 級距常數、選單選項與預設閥值
│   ├── core/
│   │   ├── calculator.ts       # 持股比例演算法與精度控制
│   │   └── parser.ts           # TDCC DOM 表格資料萃取與解析
│   ├── ui/
│   │   ├── panel.ts            # 浮動面板 DOM 構建與互動綁定
│   │   └── styles.ts           # CSS 樣式隔離注入
│   └── types/
│       └── index.ts            # TypeScript 類型定義
├── tests/
│   └── calculator.test.mjs     # 核心計算邏輯之自動化單元測試
├── manifest.json               # Manifest V3 配置
├── package.json
├── tsconfig.json
├── tsconfig.test.json
├── LICENSE
└── README.md
```

---

## 📜 授權協議 (License)

本專案採用 [MIT License](LICENSE) 授權。

