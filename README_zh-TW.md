# 🔭 Spyglass

[English](README.md) | [한국어](README_ko.md) | [日本語](README_ja.md) | [简体中文](README_zh.md) | **繁體中文**

`claude-spyglass` 幫助你觀察 Claude Code 工作階段內部實際發生的事情:

* 隱藏的系統提示詞增長
* rule、skill、agent 的注入傳播
* 上下文膨脹
* 執行階段異常（spike · loop · slow）
* 工作階段結構與工具活動
* 上下文流圖（turn → tool → 中繼文件關係）
* API token 用量、成本與延遲

與大多數專注於生產力的 Claude 工具不同，`claude-spyglass` 專注於**可見性（visibility）**。

---

## 安裝

Spyglass 支援兩種部署模式 — 兩者皆完全受支援，並共用 `~/.spyglass/` 狀態。

### 1. Headless 模式 — Homebrew Formula（推薦）

Bun standalone 伺服器 + CLI + 瀏覽器儀表板。

```bash
brew tap gmoon92/spyglass
brew install spyglass

# 常駐（登入時自動啟動）:
brew services start spyglass
spyglass open

# 或手動模式（僅目前工作階段）:
spyglass start
spyglass open

# 更新:
brew upgrade spyglass
```

打包的二進位檔已內嵌 Bun 執行階段 — **無需在系統中另外安裝 Bun。**

### 2. Local agent 模式 — Electron 應用程式

將相同的後端包裹在感知 dock 的外殼中。當 dock 可見性與作業系統整合很重要時（日常在本機使用）使用它。請從 GitHub Releases 下載 DMG。

### 解除安裝

```bash
brew uninstall spyglass
rm -rf ~/.spyglass    # 選用 — 徹底清除本機資料
```

### 從原始碼建置（貢獻者）

```bash
git clone https://github.com/gmoon92/claude-spyglass.git
cd claude-spyglass
bun install
bun run dev
```

伺服器執行後，在儀表板中開啟 **Settings → Integration**，點擊
**"Hook · Proxy 한 번에 설치"**，即可一鍵完成 hook 與 proxy 的設定。

![Dashboard Settings — Integration tab one-click install](docs/images/settings-integration.png)

---

## 為什麼會有這個專案

有一天，團隊裡一位非工程師，僅憑一條提示詞就突然達到了 80% 的上下文用量。

提示詞本身很小。
沒有使用大型附件。
工作階段幾乎是空的。

執行階段內部發生了某些變化。

我們使用 `claude-spyglass` 將問題追蹤到:

* 約 30 個 rule 文件
* 在沒有適當作用域中繼資料的情況下被誤提交
* 被全域注入到 Claude Code 的系統提示詞中

系統提示詞在無聲中爆炸了。

如果沒有執行階段的可見性，找到根本原因將極其困難。

---

## spyglass 能讓你看到什麼

![Dashboard — real-time session feed and token metrics](docs/images/dashboard.png)

### 隱藏的系統提示詞增長

查看 rule、CLAUDE.md 檔案、hook 以及執行階段注入如何影響實際的提示詞大小。

### 上下文膨脹來源

辨識哪些檔案或執行階段元件正在消耗上下文預算。

### 執行階段追蹤

Hook 路徑 — 可觀察:

* 工具呼叫的流程與時序（PreToolUse / PostToolUse）
* 工作階段結構與事件順序
* turn 層級的 token 累積

Proxy 路徑（opt-in）— 可觀察:

* 完整的 API 請求與回應中繼資料
* input / output / cache token 與估算成本
* 每秒 token 數（TPS）與首 token 時間（TTFT）
* 系統提示詞內容與雜湊

### 上下文流圖

查看工作階段如何作為關係圖實際展開，而不僅僅是一份扁平的日誌。
turn → 工具呼叫 → 中繼文件的邊由背景 sync worker 從 SQLite 串流傳輸到本機嵌入式
Ladybug 圖中，因此儀表板可以呈現祖先/後代流、hot path，以及某次工具呼叫
拉入了哪些 rule 或 agent。

### Behavior definition 目錄

了解工作階段中有哪些 agent、skill、command 處於作用中狀態。
Spyglass 會在專案鏈與全域 `~/.claude` 範圍內掃描 `.claude/agents`、`.claude/skills`、
`.claude/commands`，解析優先順序，並依工作區呈現有效的目錄。

![Meta-docs catalog — agents, skills, and commands per workspace](docs/images/meta-docs-catalog.png)

### Rule 傳播

了解 CLAUDE.md 檔案與 rule 如何在工作階段之間被注入和傳播。
查看每個專案中哪些 rule 處於作用中狀態，以及它們源自何處。

### 執行階段異常偵測

偵測三類執行階段異常:

* **spike** — 提示詞輸入 token 超過工作階段平均值的 200%
* **loop** — 同一工具在一個 turn 內連續被呼叫 3 次或以上
* **slow** — 工具呼叫耗時超過所有呼叫的 P95 閾值

---

## 設計原則: Local-first

`claude-spyglass` 完全執行在你自己的機器上。

沒有託管後端。
沒有遠端遙測。
沒有提示詞上傳。

你的:

* 提示詞
* 原始碼
* 內部 rule
* 工作階段產物
* 執行階段中繼資料

絕不會離開你的本機環境。

---

## 運作原理

`claude-spyglass` 透過兩條獨立的路徑從 Claude Code 收集執行階段資料。

**Hook 路徑**（始終作用中）: Claude Code 透過已註冊的 hook 在每個 turn 觸發事件。
hook 指令稿將原始 payload 推送到本機伺服器，伺服器對其進行正規化並儲存。

**Proxy 路徑**（opt-in）: 當 `ANTHROPIC_BASE_URL` 指向本機伺服器時，
所有 API 流量都會被攔截。這將解鎖完整的請求/回應擷取、TPS 與 TTFT。

兩條路徑都寫入同一個本機 SQLite 資料庫。更新透過 SSE（`GET /events`）串流推送到
用戶端，背景 sync worker 將資料投影到 Ladybug 圖中。

```text
── Hook Path (always on) ──────────────────────────────
Claude Code CLI
  →  spyglass-collect.sh
        →  POST /collect   (UserPromptSubmit · Pre/PostToolUse)
        →  POST /events    (SessionStart · Stop · SessionEnd · …)
── Proxy Path (opt-in) ────────────────────────────────
Claude Code CLI  →  Spyglass Server :9999/v1/*  →  Anthropic API
── Storage & streaming ────────────────────────────────
both paths  →  ~/.spyglass/spyglass.db (SQLite)
            →  SSE  GET /events                (live dashboard push)
            →  graph sync worker  →  Ladybug context-flow graph
```

這使得以下成為可能:

* 執行階段追蹤
* 提示詞檢查
* 上下文分析
* token 與延遲遙測
* 中繼文件目錄（rule、skill、CLAUDE.md）
* 執行階段 diffing

---

## 架構

![Claude Spyglass Architecture — Hook Path + Proxy Path with Storage, Meta-docs Catalog, Metrics & Analysis, SSE/REST channels, and Web/TUI clients](docs/architecture/images/architecture.png)

---

## 使用情境

* 調查突發的上下文膨脹
* 理解隱藏的提示詞與 rule 注入
* 偵錯 Claude Code 執行階段行為
* 稽核每個工作區中作用中的 agent、skill、command
* 分析工作階段結構與工具呼叫模式
* 測量真實的 API 成本與 token 消耗速率
* 偵測提示詞 spike、工具 loop 與 slow 呼叫
* 團隊層級的 Claude Code 治理

---

## 理念

AI 程式設計助理正變得越來越像複雜的執行階段系統。

但它們的大部分行為仍然是不可見的。

`claude-spyglass` 的存在，就是為了讓 Claude Code 變得可觀測（observable）。
