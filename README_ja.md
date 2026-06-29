# 🔭 Spyglass

[English](README.md) | [한국어](README_ko.md) | **日本語** | [简体中文](README_zh.md)

`claude-spyglass` は、Claude Code セッションの内部で実際に何が起きているかを観察できるようにします:

* 隠れたシステムプロンプトの肥大化
* rule・skill・agent の注入伝播
* コンテキストの膨張
* ランタイム異常（spike・loop・slow）
* セッション構造とツールの活動
* コンテキストフローグラフ（turn → tool → メタドキュメントの関係）
* API トークン使用量・コスト・レイテンシ

ほとんどの Claude ツールが生産性に焦点を当てるのに対し、`claude-spyglass` は **可視性（visibility）** に焦点を当てます。

---

## インストール

Spyglass は 2 つのデプロイモードに対応しています — どちらも完全にサポートされ、`~/.spyglass/` の状態を共有します。

### 1. Headless モード — Homebrew Formula（推奨）

Bun standalone サーバー + CLI + ブラウザダッシュボード。

```bash
brew tap gmoon92/spyglass
brew install spyglass

# 常駐（ログイン時に自動起動）:
brew services start spyglass
spyglass open

# または手動モード（現在のセッションのみ）:
spyglass start
spyglass open

# 更新:
brew upgrade spyglass
```

バンドルされたバイナリには Bun ランタイムが組み込まれており、**システムに Bun をインストールする必要はありません。**

### 2. Local agent モード — Electron アプリ

同じバックエンドを dock 対応のシェルでラップしたものです。dock の可視性や OS 統合が重要な場合（日常的にローカルで使う場合）に使用します。GitHub Releases から DMG をダウンロードしてください。

### アンインストール

```bash
brew uninstall spyglass
rm -rf ~/.spyglass    # 任意 — ローカルデータを完全削除
```

### ソースから（コントリビューター向け）

```bash
git clone https://github.com/gmoon92/claude-spyglass.git
cd claude-spyglass
bun install
bun run dev
```

サーバーが起動したら、ダッシュボードで **Settings → Integration** を開き、
**"Hook · Proxy 한 번에 설치"** をクリックすると、hook と proxy をワンクリックで設定できます。

![Dashboard Settings — Integration tab one-click install](docs/images/settings-integration.png)

---

## なぜ作ったのか

ある日、チームの非エンジニアが、たった 1 つのプロンプトで突然コンテキスト使用量 80% に達し始めました。

プロンプト自体は小さなものでした。
大きな添付ファイルもありませんでした。
セッションはほぼ空でした。

ランタイムの内部で何かが変わっていたのです。

`claude-spyglass` を使って原因を追跡した結果:

* 約 30 個の rule ドキュメント
* 適切なスコープメタデータなしで誤ってコミットされていた
* Claude Code のシステムプロンプトにグローバルに注入されていた

システムプロンプトが静かに膨れ上がっていたのです。

ランタイムの可視性がなければ、根本原因を見つけるのは極めて困難だったでしょう。

---

## spyglass で見えるもの

![Dashboard — real-time session feed and token metrics](docs/images/dashboard.png)

### 隠れたシステムプロンプトの肥大化

rule、CLAUDE.md ファイル、hook、ランタイム注入が実際のプロンプトサイズにどう影響するかを確認します。

### コンテキスト膨張の原因

どのファイルやランタイムコンポーネントがコンテキスト予算を消費しているかを特定します。

### ランタイムトレーシング

Hook パス — 以下を観察します:

* ツール呼び出しのフローとタイミング（PreToolUse / PostToolUse）
* セッション構造とイベントの順序
* turn 単位のトークン累積

Proxy パス（opt-in）— 以下を観察します:

* API リクエスト/レスポンスの全メタデータ
* input / output / cache トークンと推定コスト
* 1 秒あたりのトークン数（TPS）と最初のトークンまでの時間（TTFT）
* システムプロンプトの内容とハッシュ

### コンテキストフローグラフ

セッションが単なるフラットなログではなく、関係のグラフとして実際にどう展開するかを確認します。
turn → ツール呼び出し → メタドキュメントのエッジが、バックグラウンドの sync worker によって
SQLite からローカルの組み込み Ladybug グラフへストリーミングされるため、ダッシュボードは
祖先/子孫のフロー、hot path、そして特定のツール呼び出しがどの rule や agent を
引き込んだかを表示できます。

### Behavior definition カタログ

セッションでどの agent、skill、command が有効になっているかを把握します。
Spyglass はプロジェクトチェーンとグローバルな `~/.claude` 全体にわたって `.claude/agents`、
`.claude/skills`、`.claude/commands` をスキャンし、優先順位を解決して、ワークスペースごとの
有効なカタログを表示します。

![Meta-docs catalog — agents, skills, and commands per workspace](docs/images/meta-docs-catalog.png)

### Rule の伝播

CLAUDE.md ファイルと rule がセッション全体にどう注入され伝播するかを把握します。
各プロジェクトでどの rule が有効で、どこに由来するかを確認します。

### ランタイム異常検知

3 つのカテゴリのランタイム異常を検知します:

* **spike** — プロンプト入力トークンがセッション平均の 200% を超過
* **loop** — 同じツールが 1 つの turn 内で連続 3 回以上呼び出される
* **slow** — ツール呼び出し時間が全呼び出しの P95 閾値を超過

---

## 設計思想: Local-first

`claude-spyglass` は完全にあなたのマシン上で動作します。

ホスティングされたバックエンドなし。
リモートテレメトリなし。
プロンプトのアップロードなし。

あなたの:

* プロンプト
* ソースコード
* 内部 rule
* セッション成果物
* ランタイムメタデータ

は決してローカル環境から出ることはありません。

---

## 仕組み

`claude-spyglass` は、2 つの独立したパスを通じて Claude Code からランタイムデータを収集します。

**Hook パス**（常時アクティブ）: Claude Code は登録された hook を通じて各 turn ごとにイベントを発火します。
hook スクリプトが raw ペイロードをローカルサーバーへ送信し、サーバーがそれを正規化して保存します。

**Proxy パス**（opt-in）: `ANTHROPIC_BASE_URL` をローカルサーバーに向けると、
すべての API トラフィックが傍受されます。これにより、リクエスト/レスポンスの完全なキャプチャ、TPS、TTFT が有効になります。

両方のパスは同じローカル SQLite データベースに書き込みます。更新は SSE（`GET /events`）を通じて
クライアントへストリーミングされ、バックグラウンドの sync worker がデータを Ladybug グラフへ投影します。

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

これにより、以下が可能になります:

* ランタイムトレーシング
* プロンプト検査
* コンテキスト分析
* トークンとレイテンシのテレメトリ
* メタドキュメントカタログ（rule、skill、CLAUDE.md）
* ランタイム diffing

---

## アーキテクチャ

![Claude Spyglass Architecture — Hook Path + Proxy Path with Storage, Meta-docs Catalog, Metrics & Analysis, SSE/REST channels, and Web/TUI clients](docs/architecture/images/architecture.png)

---

## ユースケース

* 突然のコンテキスト膨張の調査
* 隠れたプロンプトおよび rule 注入の理解
* Claude Code ランタイム動作のデバッグ
* ワークスペースごとの有効な agent、skill、command の監査
* セッション構造とツール呼び出しパターンの分析
* 実際の API コストとトークン消費率の測定
* プロンプト spike、ツール loop、slow 呼び出しの検知
* チーム単位の Claude Code ガバナンス

---

## 哲学

AI コーディングアシスタントは、ますます複雑なランタイムシステムになりつつあります。

しかし、その動作の大部分は依然として見えないままです。

`claude-spyglass` は、Claude Code を観測可能（observable）にするために存在します。
