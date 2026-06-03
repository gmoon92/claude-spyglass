# Web Dashboard Architecture (React 18)

## Overview

The `claude-spyglass` web dashboard is a **React 18 SPA** that visualizes Claude Code sessions stored in a local SQLite database. It provides real-time request feeds, session browsing, meta-document catalogs, and system settings — all running locally without external data transmission.

| Item | Value |
|------|-------|
| URL | `http://localhost:9999/` |
| Default port | `9999` (env `SPGLASS_PORT`) |
| Data source | `~/.spyglass/spyglass.db` (SQLite) |
| Real-time updates | SSE `/events` (`new_request`, `new_proxy_request`, `session_update`) |
| Health check | `/health` |
| Build tool | Vite 5 (React 18, TypeScript) |

### Related Documents

| Document | Content |
|----------|---------|
| [HTTP API & SSE Reference](./api-http.md) | `/api/*` endpoints and SSE channel specs (server-side SoT) |
| [Data Flow](./data-flow.md) | Full path of a hook event from DB → SSE → screen |
| [Metrics/Analytics](./metrics-analytics.md) | burn-rate, cache, tool statistics widget formulas |
| [TUI Guide](./tui.md) | Terminal UI exposing the same data |

---

## 1. Technology Stack

| Layer | Technology | File |
|-------|-----------|------|
| Framework | React 18 + StrictMode | `packages/web/src/main.tsx` |
| Router | React Router v6 | `packages/web/src/app/App.tsx` |
| State | Zustand (3 stores) | `packages/web/src/stores/*.ts` |
| i18n | react-i18next + legacy bridge | `packages/web/src/lib/i18n.ts` |
| Build | Vite 5 + `@vitejs/plugin-react` | `packages/web/vite.config.ts` |
| Testing | Vitest + jsdom | `packages/web/package.json` |
| Bundling | ESM, vendor chunk split | `vite.config.ts` |

Legacy vanilla JS assets (`assets/js/*.js`) remain in place for backward compatibility during the transition, but the active entry point is now the React tree.

---

## 2. Component Tree

```
main.tsx
  └── <StrictMode>
        └── <App>                     (BrowserRouter)
              ├── <AppModeSync>       (URL ↔ store bidirectional sync)
              └── <AppShell>          (chrome: rail/footer/banner/modal/warning)
                    ├── <ErrorBanner> (SSE connection state)
                    ├── <AppRail>     (mode switcher: browse / metadocs / settings)
                    ├── <Footer>      (brand + keyboard help)
                    ├── children = <AppRoutes>
                    │     └── <Suspense fallback={null}>
                    │           └── <Routes>
                    │                 ├── "/"           → <BrowseLayout>
                    │                 ├── "/meta-docs"  → <MetaDocsLayout>  (lazy)
                    │                 ├── "/settings"   → <SettingsLayout>  (lazy)
                    │                 └── "*"           → <BrowseLayout>
                    ├── <UpdateBadge> / <UpdateModal>   (version polling)
                    └── <DashboardWarning>              (shallow clone alert)
```

### 2.1 App Shell (`AppShell.tsx`)

The shell wraps all route content with persistent chrome:

- **AppRail** — 56px left rail with mode icons. Active mode derived from `useLocation`, click sets `appMode` in store → `AppModeSync` navigates.
- **ErrorBanner** — Shows when SSE `onError` fires; retry triggers page reload.
- **Footer** — Brand text + "?" keyboard-help button.
- **UpdateBadge/UpdateModal** — Version polling results from `useVersionCheck`. Modal open state shared via `version-store` so sidebar badge can trigger shell modal.
- **DashboardWarning** — Shallow-clone warning banner with dismiss + copy.
- **Left panel toggle** — `Cmd/Ctrl + B` toggles `.left-panel-hidden` on `.main-layout`.

### 2.2 Browse Layout (`BrowseLayout.tsx`)

Default mode. Three-column grid: rail + left sidebar + right main.

**Left sidebar** (`BrowseSidebar` from `features/browse`):
- Project list + session list + observability cards (BurnRate, CacheHealth, LivePulse)
- Resizable panels (vertical handles)
- Version footer with update badge

**Right main**:
- **Chart section** (`#chartSection`) — TimelineChart + DonutChart + CachePanel
  - Timeline: 30-minute sliding window, live-updated from SSE feed timestamps
  - Donut: mode `type | model | cache`, controlled by `app-store.donutMode`
  - CachePanel: hit-rate + creation/read ratio bars
- **Content switcher** — `defaultView` (request feed) ↔ `detailView` (session detail)

**Data population** (mount + `activeRange` change):
- `fetchDashboard` → projects + type donut
- `fetchModelUsage` → model donut
- `fetchAllSessions` → sidebar session list
- `fetchRequests` → feed seed (merged with live SSE feed)
- `fetchCacheStats` → cache panel

### 2.3 Meta-Docs Layout (`MetaDocsLayout.tsx`)

Behavior Definitions catalog + ego-graph flow.

- **Left sidebar** — Project list (metadocs thead: Project | Items | Sync) + summary cards (used/unused/orphan + behavior mini-bar) + version footer
- **Main area** — Sub-tabs: `docs` (catalog + flow) / `tools` (tool stats matrix)
  - **Flow** (`MetaDocsFlow`) — SVG ego-graph from `/api/graph/unified-flow`. Active row auto-selected from first row with invocations.
  - **Catalog** (`MetaDocsCatalog`) — Sortable/filterable table. Columns resizable.
  - **Tool stats** (`MetaDocsToolStats`) — Project-scoped tool performance matrix.

### 2.4 Settings Layout (`SettingsLayout.tsx`)

Six sub-tabs in a 2-column grid (nav left, content right):

| Tab | Component | Responsibility |
|-----|-----------|---------------|
| diag | `DiagPanel` | System diagnostics |
| proxy | `ProxyPanel` | Proxy configuration |
| hooks | `HooksPanel` | Hook script management |
| sqlite | `SqlitePanel` | SQLite info & maintenance |
| graph | `GraphPanel` | Graph DB (Ladybug) status & install |
| server | `ServerPanel` | Server logs & config |

Each panel self-fetches via `useAsyncResource`. Refresh button remounts active panel.

---

## 3. State Management (Zustand)

Three stores, all in-memory except where noted.

### 3.1 `app-store.ts` — Routing / View / Filter SoT

| State | Initial | Persist |
|-------|---------|---------|
| `appMode` | `'browse'` | no |
| `metaSubTab` | `'docs'` | no |
| `rightView` | `'default'` | no |
| `detailTab` | `'log'` | no |
| `selectedProject` | `null` | no |
| `selectedSession` | `null` | no |
| `activeRange` | `null` | **yes** (`cs.dateRange`, preset only) |
| `feedFilter` | `'all'` | no |
| `detailFilter` | `'all'` | no |
| `searchQuery` | `''` | no |
| `donutMode` | `'model'` | no |

Actions include validation guards (e.g., `setAppMode` ignores invalid modes).

### 3.2 `sse-store.ts` — Live Data SoT

| State | Initial | Description |
|-------|---------|-------------|
| `feed` | `[]` | Live request feed (head = newest). Cap 200. |
| `proxyFeed` | `[]` | Proxy request feed. Cap 50. |
| `sessions` | `[]` | Session cache for sidebar. |
| `needsSessionsRefetch` | `false` | Signal when event references unknown session. |

Actions:
- `applyNewRequest(req)` — Upserts feed (prepend or in-place by id). Patches session `total_tokens` or sets `needsSessionsRefetch`.
- `applyNewProxyRequest(proxy)` — Prepends to proxy feed.
- `applySessionUpdate(upd)` — Patches `ended_at` or signals refetch.
- `setSessions(sessions)` — Replaces cache and clears refetch signal.

### 3.3 `version-store.ts` — Version Polling SoT

| State | Description |
|-------|-------------|
| `view` | Badge view-model (status + versions) |
| `cache` | Latest `/api/version` payload |
| `isShallow` | Shallow repository flag |
| `modalOpen` | Update modal open state (shared between sidebar badge and shell modal) |

---

## 4. Routing

React Router v6 with **mode-as-path** SoT:

| Mode | Path | Layout |
|------|------|--------|
| browse | `/` | `BrowseLayout` (sync) |
| metadocs | `/meta-docs` | `MetaDocsLayout` (lazy) |
| settings | `/settings` | `SettingsLayout` (lazy) |

`AppModeSync` handles bidirectional sync:
- **URL → store**: On location change, `pathToAppMode` corrects `store.appMode`.
- **store → URL**: On `appMode` change (e.g., rail click), `appModeToPath` navigates. Skips on initial mount to preserve deep-links.

`body[data-app-mode]` is synchronized via `useEffect` so legacy CSS mode-gates continue to work.

---

## 5. Real-Time Updates (SSE)

### 5.1 Hook: `use-sse.ts`

Imperative `createSSEController` + React `useSSE` hook:
- Creates `EventSource('/events')` on mount.
- Parses messages with Zod schema (`parseSSEMessage`).
- 5-second backoff retry on error.
- Cleanup on unmount: closes `EventSource` + clears retry timer.

### 5.2 Wiring: `sse-wiring.ts`

Maps SSE callbacks to `sse-store` actions:
- `onNewRequest` → `sseStore.applyNewRequest`
- `onNewProxyRequest` → `sseStore.applyNewProxyRequest`
- `onSessionUpdate` → `sseStore.applySessionUpdate`

Lifecycle callbacks (`onOpen`/`onError`) are composed in `AppShell` to drive `ErrorBanner` visibility.

### 5.3 Data Flow

```
Server SSE (/events)
  → useSSE (parse + validate)
    → sse-store (state transition)
      → React components re-render (feed/sessions subscriptions)
```

No DOM manipulation — all updates are declarative via Zustand subscriptions.

---

## 6. i18n System

### 6.1 Architecture

**Dual system during transition:**
- **New**: react-i18next (`useTranslation`) — components re-render on language change without reload.
- **Legacy**: `window.I18n` (IIFE scripts) — vanilla JS modules still reference it.

Both systems are kept in sync: `main.tsx` initializes `i18next.changeLanguage(window.I18n.getLang())` and registers an `onChange` listener.

### 6.2 Configuration (`lib/i18n.ts`)

- **Backend**: Custom merged backend fetches all 5 legacy namespaces (`common`, `request`, `badges`, `session`, `ui`) in parallel and merges them into a single `translation` resource.
- **Key format**: `ui.cache-panel.hit-rate.desc` works unchanged (dot-path with `nsSeparator: false`).
- **Interpolation**: `{var}` single-brace (matches legacy JSON format).
- **Fallback**: `parseMissingKeyHandler` delegates to `window.I18n.t` if key missing.
- **Language resolution**: URL `?lang=` → `localStorage['spyglass:lang']` → `navigator.language` → `'ko'`.

### 6.3 Usage in Components

Components use `useTranslation()` and pass a `TFunc` labeler to memoized children:

```tsx
const { t, i18n } = useTranslation();
const tx = useCallback((key: string, vars?: Record<string, unknown>) => t(key, vars) as string, [t]);
const labeler = useMemo(() => makeI18nLabeler(tx), [i18n.language, tx]);
```

`i18n.language` is included in `useMemo` deps so memoized components receive new labeler refs on language switch.

---

## 7. Build System (Vite)

### 7.1 Config (`vite.config.ts`)

- **Entry**: `index.html` (with `#react-root` mount point)
- **Plugins**:
  - `@vitejs/plugin-react` — Fast Refresh, JSX transform
  - `externalizeDaemonAssets` — Injects 24 legacy CSS files + 3 classic i18n scripts into `index.html` (dev + build)
- **Output**: `dist/` with `assets/` subdir (matches daemon static serving contract)
- **Vendor chunk**: `node_modules` → separate `vendor.js` (cache-friendly)
- **Source maps**: Disabled in production unless `SPYGLASS_SOURCEMAP=1`
- **Dev proxy**: `/api`, `/events`, `/collect`, `/v1`, `/health`, `/locales` → `http://127.0.0.1:9999`

### 7.2 Asset Strategy

Legacy CSS and i18n JS are **not bundled** by Vite. They are served raw by the daemon and injected into `index.html` via the custom plugin. This ensures:
- Dev server (port 5173) and production build share identical CSS/i18n loading
- Vanilla JS modules can still reference `window.I18n` before React mounts
- `locales/` copied to `dist/locales` on build

---

## 8. Feature Areas

### 8.1 Browse (`features/browse`)

| Export | File | Responsibility |
|--------|------|---------------|
| `BrowseSidebar` | `BrowseSidebar.tsx` | Left panel: projects + sessions + obs cards + footer |
| `useObsCards` | `use-obs-cards.ts` | Observability card data fetching |
| `usePanelResize` | `use-panel-resize.ts` | Vertical panel resize handlers |

### 8.2 Dashboard (`features/dashboard`)

| Export | File | Responsibility |
|--------|------|---------------|
| `BurnRateCard`, `CacheHealthCard`, `LivePulseCard`, `ToolCategoriesCard`, `AnomalyBadge` | `ObsPanel.tsx` | Observability cards |
| `CachePanel` | `CachePanel.tsx` | Cache hit-rate + ratio bars |
| `SparklineBars`, `SparklineLine` | `Sparkline.tsx` | Mini sparklines |
| `ContextChart` | `ContextChart.tsx` | Session detail context growth canvas |
| `ToolStatsMatrix` | `ToolStatsMatrix.tsx` | Tool usage matrix |
| `SystemPromptLibrary` | `SystemPromptLibrary.tsx` | System prompt catalog |
| `UpdateBadge`, `UpdateModal`, `useVersionCheck` | various | Version check UI + polling hook |
| `fetchModelUsage`, `fetchToolCategories` | `metrics-fetchers.ts` | Metrics API wrappers |

### 8.3 Session Detail (`features/session-detail`)

| Export | File | Responsibility |
|--------|------|---------------|
| `SessionLog` | `SessionLog.tsx` | Unified log view (turn spine + log pane) |
| `TurnRows` | `TurnRows.tsx` | Turn row rendering |
| `DetailView` | `DetailView.tsx` | Detail view assembly (FlowPane + SessionLog) |
| `SessionDetailContainer` | `SessionDetailContainer.tsx` | Data orchestration container |
| `useSessionDetail` | `use-session-detail.ts` | Turns fetch + state |
| `fetchSessionTurns` | `turns-fetcher.ts` | Turn data fetching |
| `Chip`, `ChipFlow`, `TurnSpine`, `FlowHead`, `FlowPane` | various | Turn sub-components |
| `useLlmInput`, `useSystemPromptLibrary` | `use-detail-aux.ts` | LLM Input / System Library tabs |

### 8.4 Meta-Docs (`features/meta-docs`)

| Export | File | Responsibility |
|--------|------|---------------|
| `MetaDocsCatalog` | `MetaDocsCatalog.tsx` | Sortable/filterable catalog table |
| `MetaDocsSearch` | `MetaDocsSearch.tsx` | Search input |
| `MetaDocsFilterBar` | `MetaDocsFilterBar.tsx` | Type / display / include-deleted filters |
| `MetaDocsFlow` | `MetaDocsFlow.tsx` | SVG ego-graph flow |
| `MetaDocsToolStats` | `MetaDocsToolStats.tsx` | Tool stats matrix |
| `MetaDocsSummaryCards`, `MetaDocsBehaviorBars` | `MetaDocsSummaryCards.tsx` | Left summary cards |
| `fetchProjectToolStats` | `tool-stats-fetcher.ts` | Tool stats API |
| Flow pure libs | `flow-*.ts` | Camera, graph, edge, layout algorithms |

### 8.5 Settings (`features/settings`)

| Export | File | Responsibility |
|--------|------|---------------|
| `DiagPanel`, `HooksPanel`, `ServerPanel`, `GraphPanel`, `SqlitePanel`, `ProxyPanel` | various | Six setting panels |
| `*PanelView` | various | Presentational views for each panel |
| `useAsyncResource` | `use-settings-diag.ts` | Generic async fetch hook |
| `fetchDiag`, `fetchLogs`, `hookApply`, etc. | `hooks-api.ts` | Settings API wrappers |
| `fetchGraphDbStatus`, `ladybugInstallStream`, etc. | `graph-api.ts` | Graph DB API |

---

## 9. Design System

Located in `packages/web/src/components/design-system/`.

### 9.1 Primitives

| Component | File |
|-----------|------|
| `FilterButton` | `primitives/FilterButton.tsx` |
| `CloseButton` | `primitives/CloseButton.tsx` |
| `Tab` | `primitives/Tab.tsx` |

### 9.2 Icons

All icons are stroke-only SVG components with `currentColor`:

| Icon | File | Usage |
|------|------|-------|
| `AgentDot`, `SkillDot`, `ToolDot`, `McpDot` | `icons/*Dot.tsx` | Type markers |
| `StatusActive`, `StatusStale`, `StatusEnded` | `icons/Status*.tsx` | Session status |
| `Chevron`, `Search`, `Copy`, `Refresh`, etc. | various | UI actions |

### 9.3 Badges & Chips

| Component | File |
|-----------|------|
| `Badge` | `badges/Badge.tsx` |
| `Chip` | `chips/Chip.tsx` |
| `Dot` | `markers/Dot.tsx` |
| `SortHead` | `markers/SortHead.tsx` |

### 9.4 Stats

| Component | File |
|-----------|------|
| `Bar` | `stats/Bar.tsx` |

### 9.5 CSS Tokens

Design tokens remain in the legacy `packages/web/assets/css/design-tokens.css` (dark theme). All React components reference the same CSS custom properties (`--bg`, `--surface`, `--text-1`, `--error`, etc.).

---

## 10. Core Rendering Utilities

The following functions from the legacy vanilla JS codebase are still the **rendering SoT** and are imported/reused by React components. Do not inline equivalent HTML.

| Function | Legacy Location | React Usage | Signature |
|----------|----------------|-------------|-----------|
| `toolIconHtml` | `assets/js/render/badges.js:58` | `ToolIcon` component, `TargetCell` | `(toolName, eventType?) → string` |
| `makeTargetCell` | `assets/js/render/cells.js:73` | `TargetCell` component | `(r) → <td>` |
| `makeRequestRow` | `assets/js/render/rows.js:51` | `RequestRow` component | `(r, opts) → <tr>` |
| `prependRequest` | `assets/js/views/default/feed-live.js:31` | `sse-store.applyNewRequest` | `(r) → void` |

**`toolIconHtml(toolName, eventType)`**: Returns SVG icon HTML. If `eventType === 'pre_tool'`, attaches `tool-icon-running` pulse animation. Always pass `r.event_type` as the second argument.

**`makeTargetCell(r)`**: Returns full `Target` column (`<td class="cell-target">`) — icon + name + sub-name + error status badge.

**`makeRequestRow(r, opts)`**: Returns a `<tr>` with 9 columns. All `<td>` cells have `data-cell` attributes for in-place updates. Options: `showSession`, `anomalyFlags`.

**`prependRequest(r)`** (legacy) / **`sse-store.applyNewRequest`** (React): Prepends a new row to the feed or updates an existing row by `id` in-place (preserving scroll position and expand state). Caps at 200 rows (`FEED_CAP`).

---

## 11. Data Fetching

### 11.1 Fetchers (`api/fetchers.ts`)

Pure fetch functions — no store references, no DOM side effects:

| Function | Endpoint | Returns |
|----------|----------|---------|
| `fetchDashboard(range, signal)` | `/api/dashboard` | `{ projects, types, summary }` |
| `fetchRequests(opts, signal)` | `/api/requests` | `RequestRowData[]` |
| `fetchAllSessions(range, limit, signal)` | `/api/sessions` | `Session[]` |
| `fetchCacheStats(range, signal)` | `/api/stats/cache` | `CacheStats` |
| `fetchMetaDocs(opts, signal)` | `/api/meta-docs` | `MetaDocRow[]` |

All fetchers use Zod schema validation (`schema/api-schema.ts`) and return safe fallbacks (`[]` or `null`) on failure.

### 11.2 Range Parameters

`app/compute-range.ts` converts `ActiveRange` (store) to fetcher params:
- `rangeToParams(activeRange)` → `{ from?, to? } | {}` — for REST endpoints
- `rangeToMetricParams(activeRange)` → `{ from?, to? } | { range: 'all' }` — for metrics endpoints

---

## 12. Interaction Reference

| Action | Mechanism |
|--------|-----------|
| Mode switch | Click rail icon → `setAppMode` → `AppModeSync` navigates |
| Project select | Click project row → `setSelectedProject` → sessions filtered |
| Session select | Click session row → `setSelectedSession` + `setRightView('detail')` |
| Feed filter | `FilterBar` → `setFeedFilter` → memoized filter on `feedRows` |
| Feed search | `SearchBox` → `setSearchQuery` → `buildSearchHaystack` filtering |
| Date range | `DateRangeDropdown` → `setActiveRange` → effect refetches data |
| Chart collapse | Toggle button → local state → CSS class |
| Left panel toggle | `Cmd/Ctrl + B` → `leftPanelHidden` state → CSS class |
| Detail tab | `SessionDetailContainer` internal tab state (log / llm / syslib) |
| Meta sub-tab | `setMetaSubTab` (`docs` / `tools`) |
| Settings tab | Local `useState` in `SettingsLayout` |
| Row expand | Click message preview → `PromptExpandRow` toggle |
| Chip jump | Click turn chip → `handleChipActivation` scrolls + flashes target row |

---

## 13. File Reference

| Category | Path |
|----------|------|
| Entry point | `packages/web/src/main.tsx` |
| App shell | `packages/web/src/app/App.tsx`, `AppShell.tsx`, `AppRoutes.tsx` |
| Layouts | `packages/web/src/app/BrowseLayout.tsx`, `MetaDocsLayout.tsx`, `SettingsLayout.tsx` |
| Stores | `packages/web/src/stores/app-store.ts`, `sse-store.ts`, `version-store.ts` |
| SSE hook | `packages/web/src/hooks/use-sse.ts` |
| SSE wiring | `packages/web/src/features/sse/sse-wiring.ts` |
| i18n | `packages/web/src/lib/i18n.ts` |
| Fetchers | `packages/web/src/api/fetchers.ts` |
| Range utils | `packages/web/src/app/compute-range.ts` |
| Browse data | `packages/web/src/app/browse-data.ts` |
| App mode routes | `packages/web/src/app/app-mode-route.ts` |
| Render components | `packages/web/src/components/render/*.tsx` |
| Design system | `packages/web/src/components/design-system/**/*.tsx` |
| Settings components | `packages/web/src/components/settings/*.tsx` |
| Vite config | `packages/web/vite.config.ts` |
| Package manifest | `packages/web/package.json` |
| Legacy render SoT | `packages/web/assets/js/render/{badges,cells,rows,model}.js` |
| Legacy formatters | `packages/web/assets/js/formatters.js` |
| Legacy request types | `packages/web/assets/js/request-types.js` |
