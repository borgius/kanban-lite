# Changelog

All notable changes to the Kanban Lite extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **SDK bootstrap reads config once**: `new KanbanSDK()` previously triggered five `readBootstrapConfig` → provider round-trips during construction (one per capability resolver: storage, auth, webhooks, card-state, callbacks). Bootstrap reads intentionally bypass the request-scoped cache (fail-closed), so each call was a separate round-trip on remote `config.storage` backends (Cloudflare KV, MySQL, PostgreSQL). The SDK constructor now reads the bootstrap config once and reuses it across all five normalize calls, cutting SDK construction cost by ~5× on remote backends.

- **Broadcast fanout shares one config read**: `broadcastPerClient` previously opened a new `withConfigReadCache` scope per client in the broadcast loop, so an N-client fanout performed N `readConfig` provider round-trips for a config that is identical for every client. The cache scope is now hoisted across the entire fanout, collapsing N round-trips into one per broadcast. Large multi-client boards served by Cloudflare KV or remote `config.storage` backends see proportional latency wins on every `init` / `cardsUpdated` broadcast.

### Added

- **Request-scoped `readConfig()` cache**: Added a `withConfigReadCache()` scope in `shared/config` that coalesces the ~6 `readConfig(workspaceRoot)` calls a single init/broadcast triggers (`getSettings`, `listColumns`, `listBoards`, `getLabels`, `getMinimizedColumns`, base-message builder, per-handler default-board lookups, webhook dispatch, …) into one provider round-trip per request. The standalone `syncWebviewMessages`, `broadcastPerClient`, and `sendInitMessage` paths now run inside this scope, cutting Cloudflare KV / remote `config.storage` round-trips on active boards by 5–6× and eliminating redundant `.env` loading and `${VAR}` placeholder resolution within each scope. The cache is invalidated automatically on `writeConfig`, and unscoped callers keep the existing fresh-object mutation contract.

- **Graphify workspace setup for Copilot**: Added a repo-local `.graphifyignore`, wired `graphify-out/graph.json` into [`.vscode/mcp.json`](.vscode/mcp.json) as a local `graphify` MCP server, and documented the recommended Graphify + Copilot refresh flow in the root README so Agent mode can query the repo graph directly.

- **Cross-platform voice comments**: Card comments can now carry linked audio clips with an optional typed note. Desktop runtimes (standalone browser + VS Code webview) and the Expo mobile task-detail screen now expose recorder/playback UI, store voice clips as task attachments, render inline play controls for saved voice comments, and remove the linked audio attachment automatically when the parent voice comment is deleted.

- **Cloudflare deploy script custom domains**: `scripts/deploy-cloudflare-worker.mjs` now accepts repeatable `--custom-domain <hostname>` values plus `KANBAN_CF_CUSTOM_DOMAIN` / `KANBAN_CF_CUSTOM_DOMAINS` env defaults, supports an explicit `--custom-domain-zone` / `KANBAN_CF_CUSTOM_DOMAIN_ZONE` override, emits Worker `custom_domain` route blocks in the generated `wrangler.toml`, and keeps `workers_dev = true` so deployments can attach hostnames such as `kl.incidentmind.com` without manual Wrangler edits or losing the default `*.workers.dev` URL.

- **Meta tab — inline YAML metadata editor**: The shared card editor now includes a `Meta` tab that lets users edit `frontmatter.metadata` as raw YAML inside a CodeMirror editor. In edit mode, valid changes are autosaved via the existing 800 ms debounce pipeline. In the create-card dialog, metadata is staged locally and included in the card payload when the dialog is saved; the Save button is disabled while the YAML draft is invalid. Invalid YAML is never persisted — it stays as local draft text with an inline error message until corrected.

- **First-party callback runtime plugin** (`kl-plugin-callback`): Added the shared `callback.runtime` plugin-settings flow with an ordered mixed `handlers[]` model for inline and subprocess handlers. Inline handlers are trusted same-runtime JavaScript invoked as `({ event, sdk })`; process handlers receive serialized event JSON on stdin only; per-handler failures are logged while later matches continue.

- **Async plugin option-schema resolution helper**: Plugin settings discovery now resolves sync/async `optionsSchema()` metadata before it reaches SDK/UI/API/CLI/MCP consumers, and plugin authors can use the shared SDK helper to populate schema or UI values from runtime data such as the live available-event catalog.

- **Auth plugin provider-option UI schemas**: `kl-plugin-auth` now ships explicit JSON Forms `uiSchema` metadata for `auth.identity` and `auth.policy`, giving the shared Plugin Options workflow grouped sections, inline array detail editors, and a small conditional rule for permission-action editing instead of the generic fallback layout.

- **Available event discovery across SDK/API/CLI/MCP**: `KanbanSDK` now exposes `listAvailableEvents({ type?, mask? })` so callers can inspect built-in before/after events with optional wildcard filtering. SDK extension plugins may declare extra discoverable events through `sdkExtensionPlugin.events`, and the same catalog is now exposed through `kl events`, standalone `GET /api/events`, and the MCP `list_available_events` tool.

- **Dynamic auth role catalogs and editable permission matrices**: `kl-plugin-auth` now lets local auth configs maintain a reusable `roles[]` catalog that defaults to `user`, `manager`, and `admin`, drives the shared Plugin Options role picker, still allows adding or deleting extra roles as a normal array, drops local-user group editing from `auth.identity`, preserves arbitrary role strings at runtime, keeps `auth.policy.options.permissions[]` available for custom per-role action rules, and teaches `kl auth create-user --role <role>` to auto-register new roles in that catalog.

- **`kl openauth add-user` command and hashed embedded-issuer passwords**: `kl-plugin-openauth` now exports a `cliPlugin` with an `add-user` sub-command. Running `kl openauth add-user --email alice@example.com --password s3cr3t --role admin` scrypt-hashes the password using OpenAuth's built-in `ScryptHasher` and writes the `passwordHash` object into `plugins["auth.identity"].options.embeddedIssuer.password.users` in `.kanban.json` — the plain-text password is never stored on disk. The embedded issuer now pre-seeds `MemoryStorage` with those hashes at startup so pre-configured users can log in immediately without a registration step. Plain-text `password` values in existing configs are still accepted but are hashed at runtime with a deprecation warning. New exports `hashPassword(plain)`, `isHashedPassword(value)`, and `ScryptHasherResult` are available from the package for programmatic use.

- **Modern React lint guardrails for contributors and agents**: Added stricter React/TSX ESLint rules for self-closing JSX, boolean props, useless fragments, stable key guidance, and nested-component warnings, plus workspace instruction files that tell agents to keep React changes lint-clean instead of papering over rules with inline disables.

- **Standard plugin package manifest** (`pluginManifest` export): Every first-party plugin package now exports a `pluginManifest` constant declaring its capabilities and integration surfaces. The engine uses this manifest for fast, reliable discovery instead of exhaustive duck-typing. New types `KLPluginPackageManifest` and `PluginIntegrationNamespace` are exported from `kanban-lite/sdk`. All first-party plugin packages (`kl-plugin-auth`, `kl-plugin-storage-sqlite`, `kl-plugin-storage-mysql`, `kl-plugin-storage-postgresql`, `kl-plugin-storage-mongodb`, `kl-plugin-storage-redis`, `kl-plugin-attachment-s3`, `kl-plugin-webhook`) include the manifest. Third-party plugins without `pluginManifest` still work via the legacy probing fallback.

### Changed

- **Board settings standalone routes**: Standalone browser navigation now deep-links the Board settings sub-tabs at `/settings/board/defaults`, `/settings/board/title`, `/settings/board/actions`, `/settings/board/labels`, and `/settings/board/meta`, and legacy `/settings/defaults` / `/settings/labels` links redirect to the matching nested board routes.

- **Settings-panel config coverage**: The shared settings UI now persists `showBuildWithAI`, `markdownEditorMode`, and `drawerPosition`, adds board-level editors for `boards.<id>.title` and `boards.<id>.actions`, and keeps plugin-provider rows distinct by `capability + providerId` so same-package variants no longer collapse into one entry.

- **Card write editor now uses CodeMirror**: The main `Edit` tab in the shared card editor now uses CodeMirror for markdown authoring, keeping the existing toolbar shortcuts while giving the standalone app and VS Code webview the same editor surface as other code-enabled inputs.

- **Metadata field settings simplification**: The Board → Meta settings view now uses a quieter form-and-list layout with stacked edit fields, duplicate-key validation, inline editing, and more straightforward controls for preview visibility, defaults, and descriptions.

- **First-party plugin package builds now run on shared Vite library config**: All `kl-plugin-*` packages now build CommonJS output and `.d.ts` declarations through one `vite build` entrypoint backed by a shared workspace config, replacing the old split `esbuild` + `tsc --emitDeclarationOnly` flow.
- **First-party plugin package watch mode now mirrors the shared Vite build**: All `kl-plugin-*` packages now expose a `watch` script that runs the same shared Vite library build in watch mode, so root `watch:workspace` picks them up automatically.

- **`kl-plugin-auth` action pickers now use the live before-event catalog**: When an SDK instance is available, the shared Plugin Options form resolves `auth.policy.permissions[].actions[]` from `sdk.listAvailableEvents({ type: 'before' })`, so custom permission rules follow the current runtime event surface instead of a stale hard-coded list.

- **Plugin option-schema authoring types now allow nested async schema values**: `PluginSettingsOptionsSchemaMetadata.schema` / `uiSchema` now accept nested sync/async resolvers in the public SDK typings, so plugin packages can declare runtime-derived enums/defaults without unsafe casts while transports still receive fully resolved plain JSON Forms metadata.

- **Plugin authoring contracts now come from the SDK**: First-party plugin packages now import shared provider, auth, CLI, standalone, MCP, card-state, and plugin-settings metadata types from `kanban-lite/sdk` instead of re-declaring local structural copies. The SDK export surface now includes the additional plugin authoring types needed for that workflow.
- **Card-state merged into storage plugins**: `card.state` is no longer a separate capability that requires a dedicated package. Each storage plugin (`kl-plugin-storage-sqlite`, `kl-plugin-storage-mongodb`, `kl-plugin-storage-postgresql`, `kl-plugin-storage-mysql`, `kl-plugin-storage-redis`) now exports `createCardStateProvider` and card-state is auto-derived from the active storage plugin at startup. The built-in file-backed provider remains the fallback for `markdown` storage. Dedicated `kl-plugin-card-state-*` packages are deprecated and will be removed in a future release.
- **`CARD_STATE_PROVIDER_ALIASES`** now points to storage packages instead of dedicated card-state packages.
- **Canonical local file provider IDs**: `card.storage` and default `card.state` now use `localfs` as the canonical provider id in runtime capabilities, plugin-settings inventory, and status surfaces. Legacy ids (`card.storage: "markdown"`, `card.state: "builtin"`) are normalized for compatibility and no longer treated as separate installable providers.
- **Storage-backed `card.state` config now stays implicit**: shared config normalization, Plugin Options inventory, and provider persistence now reuse the active `card.storage` provider/options for storage-backed `card.state`, hide the duplicate DB form for those rows, and automatically prune redundant matching `plugins["card.state"]` entries from `.kanban.json`.
- **Storage-backed `attachment.storage` config now stays implicit**: shared config normalization, Plugin Options inventory, and storage-migration cleanup now reuse the active `card.storage` provider/options for first-party storage-backed attachment handlers, hide duplicate DB forms for those rows, and automatically prune redundant matching `plugins["attachment.storage"]` entries from `.kanban.json`.
- **Plugin Options toggles and grouped capability forms**: The Settings panel now uses on/off toggles instead of Activate/Active buttons for provider selection, shows a spinner while a provider toggle mutation is pending, renders schema-driven options in dedicated sections after the capability list, hides duplicate auth-package capability aliases such as unselected `rbac` rows, and supports explicitly disabling `webhook.delivery` with `provider: "none"` while preserving stored webhook options for later re-enable.
- **Callback inline-source authoring UI**: The shared Plugin Options form now renders `kl-plugin-callback` inline `source` fields with an embedded CodeMirror JavaScript editor instead of a plain multiline text input, while keeping the same schema-driven `handlers[]` contract.

- **Comment composer now uses CodeMirror**: The shared card comments tab now uses the same CodeMirror-backed markdown editor as the main body `Edit` tab, preserving toolbar shortcuts, preview, and draft-clear behavior after posting a new comment.
- **Comment author defaults now follow session identity**: The shared card comments tab now pre-fills the author field from the logged-in username when the current session resolves an identity, and otherwise falls back to `User`.

### Fixed

- **Shared settings panel parity**: Restored the missing **Board → Title** and **Board → Actions** sub-tabs in the shared settings UI, re-synced routed board-settings deep links with the left-rail sub-tab selection, brought back support-flag-controlled `showBuildWithAI` / `markdownEditorMode` controls, and kept Plugin Options rows distinct by `capability + providerId` so same-package variants stay selectable.

- **Standalone settings preservation for extension-only fields**: Opening or saving settings from standalone mode no longer stomps stored `showBuildWithAI` / `markdownEditorMode` values when the host hides those unsupported controls; support flags now hide the UI while preserving persisted config.

- **Cloudflare deploy resource/plugin defaults**: Repeated `scripts/deploy-cloudflare-worker.mjs --create-resources` runs now reuse existing R2 buckets instead of surfacing Wrangler's “bucket already exists” error every time, and Worker bundles now honor the default `webhook.delivery` provider (`webhooks` → `kl-plugin-webhook`) unless Cloudflare config explicitly disables it with `provider: "none"`. The repo's default `.kanban.cloudflare.json` now keeps webhook delivery enabled for Cloudflare deploys.

- **Cloudflare Worker live cross-tab refreshes**: Worker deployments now accept `/ws` through the generated Durable Object seam and use event-driven `syncRequired` invalidations plus HTTP latest-state resync, so committed mutations in one browser refresh other connected tabs without periodic polling. The Worker path still targets latest-state catch-up rather than full raw Node WebSocket payload parity.

- **Cloudflare Worker active-card persistence**: The standalone Worker runtime now stores workspace active-card selection in a generated Durable Object, so HTTP bridge open/preview flows keep `/api/tasks/active` working without a writable `.active-card.json` sidecar. Non-Worker hosts still fall back to the local file-backed active-card state.

- **Standalone Cloudflare Worker browser bootstrap**: The standalone browser shim now falls back to an HTTP webview-sync bridge when the Cloudflare Worker entrypoint returns `501` for `/ws`, so deployed boards load and keep handling user actions instead of hanging forever on `Loading...`.

- **Plugin Options helper text now shows without focusing fields**: The shared Settings → Plugin Options form now surfaces schema-level descriptions and keeps field descriptions visible even before focus, so provider setup notes such as S3 environment-variable guidance are actually visible in the UI instead of hiding behind JSON Forms focus state.

- **S3 attachment plugin options-form env guidance**: `kl-plugin-attachment-s3` now describes `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_REGION` directly in its schema metadata and matching docs, making it clearer that the shared Plugin Options form only edits non-secret settings while credentials still come from the host environment or workspace `.env`.

- **Webhook plugin-option IDs now self-heal on save**: Saving `webhook.delivery` provider options now auto-generates a `wh_…` id for any webhook row whose ID is left blank in the schema-driven Plugin Options form, instead of persisting an empty identifier.

- **RBAC plugin-settings default persistence**: Selecting `auth.policy: rbac` with no saved options now materializes the canonical `RBAC_ROLE_MATRIX` into `plugins["auth.policy"].options.permissions`, so the shared Plugin Options flow starts from the built-in editable matrix instead of an empty config.

- **Redis `card.state` provider no longer connects during load/build**: `kl-plugin-storage-redis` now creates its `ioredis` client lazily with `lazyConnect`, matching the storage engine path so package discovery and workspace builds do not emit stray `ECONNREFUSED` errors just from resolving the provider.

- **Plugin settings disabled-provider option persistence**: Schema-driven provider forms now remain visible and saveable even when a provider is toggled off. Inactive-provider edits are cached under `pluginOptions[capability][providerId]`, selected-provider enablement still stays tied to `plugins[capability].provider`, and re-enabling a provider restores its cached options automatically.

- **Auth policy options matrix UX**: `kl-plugin-auth` now treats shared `auth.policy.permissions[]` rows as role-based by default, sources role choices from `auth.identity.options.roles`, and filters the action picker to before-events only so new permission rows save as valid, usable policy rules without an extra subject-type field.

- **Auth policy permission rows are now explicitly role-based**: `kl-plugin-auth` now uses `auth.policy.options.permissions[].role` instead of `subject`, removes unused group-only matrix handling from the shared auth-policy path, and keeps legacy `options.matrix` role maps working for existing workspaces.

- **Plugin settings table-array buttons**: Styled the JSON Forms table-based array add/delete controls in the Settings panel so primitive list editors such as the auth role catalog no longer render unthemed browser-default buttons.

- **Plugin settings SDK type narrowing**: Tightened the local record guard and options-schema normalization in `packages/kanban-lite/src/sdk/plugins/index.ts` so plugin-settings metadata compiles cleanly under stricter TypeScript checks without treating validated records as `unknown`.

### Added

- **MongoDB storage plugin** (`kl-plugin-storage-mongodb`): New external storage provider package for MongoDB. Cards and comments are persisted in MongoDB collections (`kanban_cards`, `kanban_comments`). Attachments remain on the local filesystem. Requires the `mongodb` driver as a peer dependency. Provider id: `mongodb`.
- **MongoDB card-state plugin** (`kl-plugin-card-state-mongodb`): New external `card.state` provider for MongoDB-backed actor-scoped card state (unread cursors, explicit-open state). Stores state in a `card_state` collection with a unique compound index. Provider id: `mongodb`.
- **Redis storage plugin** (`kl-plugin-storage-redis`): New external storage provider package for Redis. Cards and comments are persisted in Redis hashes. Attachments remain on the local filesystem. Requires the `ioredis` driver as a peer dependency. Provider id: `redis`.
- **Redis card-state plugin** (`kl-plugin-card-state-redis`): New external `card.state` provider for Redis-backed actor-scoped card state (unread cursors, explicit-open state). Stores state as JSON strings with composite keys. Provider id: `redis`.
- **PostgreSQL storage plugin** (`kl-plugin-storage-postgresql`): New external storage provider package for PostgreSQL. Cards and comments are persisted in PostgreSQL tables (`kanban_cards`, `kanban_comments`). Attachments remain on the local filesystem. Requires the `pg` driver as a peer dependency. Provider id: `postgresql`.
- **Capability-grouped Plugin Options workflow**: Added the shared plugin-settings experience across the Settings panel, CLI, REST API, and MCP so users can list discovered providers, select one provider per capability, edit schema-driven provider options, and run guarded plugin installs from consistent public surfaces.
- **CrewAI tool adapter** (`kl-adapter-crewai`): New Python package at `packages/kl-adapter-crewai` wrapping kanban-lite REST API operations as CrewAI `BaseTool` subclasses (9 tools: list/get/create/update/move/delete cards, list columns, get/add comments). Includes a `KanbanLiteToolkit` helper with `read_only` mode for reporting agents. Enables specialized agents (PM, Dev, QA) to each manage their own board lane.

- **LangChain / LangGraph adapter** (`kl-adapter-langchain`) — new package at `packages/kl-adapter-langchain` exposing all kanban-lite features as 39 LangChain `StructuredTool` instances.
  - Card tools: list, get, create, update, move, delete, filter by status, trigger actions.
  - Comment tools: list, add, update, delete, streaming comments (`kanban_stream_comment` + `streamCommentDirect` helper).
  - Column tools: list, add, update, remove, reorder.
  - Label tools: get, set, delete, rename, unique assignees/labels, filter by label group.
  - Board tools: list, get, create, delete, update, get actions.
  - Log tools: list, add, clear (card-level and board-level).
  - Attachment tools: list, add, remove.
  - `createKanbanToolkit(sdk, options?)` — single-call factory with category filters.
  - Optional LangGraph integration: `getKanbanBoardState()` annotation, `createRefreshBoardNode()`, `createKanbanToolNode()`.

- **Vercel AI Chat SDK adapter package** (`kl-adapter-vercel-ai`): New reusable npm package that provides pre-built Vercel AI SDK `tool()` definitions and a configurable REST client for kanban-lite. Includes 13 tools covering cards CRUD, comments (including streaming), labels, actions, forms, columns, and board info. Drop `createKanbanTools()` into any `streamText()` route to get full kanban-lite integration.

- **CLI `--token` override**: `kl` now accepts `--token <value>` as a per-invocation auth override, ahead of `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN`, and reports the source as `flag` in `kl auth status` diagnostics.

- **Streaming comments** — AI agents and automation tools can now create comments and stream their content live to connected viewers.
  - New `sdk.streamComment(cardId, author, asyncIterable, options?)` method accepts any `AsyncIterable<string>` (e.g. an AI SDK `textStream` or `fullStream`) and persists the comment once the stream is exhausted.
  - New REST endpoint `POST /api/tasks/:id/comments/stream?author=<name>` accepts a streaming request body (`Content-Type: text/plain`, chunked-transfer). On-the-fly text chunks are broadcast to all connected WebSocket clients as `commentStreamStart` / `commentChunk` / `commentStreamDone` events.
  - New CLI subcommand `kl comment stream <card-id> --author <name>` reads from stdin and streams it as a comment — useful for piping LLM output: `llm generate | kl comment stream 42 --author ci-agent`.
  - New MCP tool `stream_comment` (same parameters as `add_comment`) that routes content through the streaming SDK path.
  - Webview shows a live blinking-cursor indicator and a `streaming` badge on comments currently being written by an agent; edit/delete actions are hidden until the stream completes.
  - `Comment` interface gains an optional `streaming?: boolean` field that is set on in-flight WS messages but is **not** persisted to storage.
  - Three new `ExtensionMessage` variants: `commentStreamStart`, `commentChunk`, `commentStreamDone`.

 Boards may now define `boards.<id>.title` as an ordered metadata-key list in `.kanban.json`. Matching metadata values prefix user-visible card titles consistently across the webview, VS Code sidebar, CLI, and MCP read surfaces without changing stored markdown titles or filenames.

### Fixed

- **Package lint cleanup for `kanban-lite`**: Cleared the remaining `eslint` failures across the webview, SDK, CLI, tests, and declaration files by removing stale unused symbols, replacing lingering `any` types with `unknown`, fixing React hook/compiler warnings, and stabilizing several list keys.
- **Plugin settings secret/install safety**: Persisted secret fields now reopen only as masked write-only placeholders, unchanged masks preserve existing secrets on save, and the in-product installer accepts only exact unscoped `kl-*` package names while redacting surfaced diagnostics.
- **CLI mutation auth parity**: CLI mutating commands now consistently run through the shared auth wrapper, so authenticated actions such as `kl comment add ...` honor the resolved CLI token instead of failing with a false `Authentication required` error.
- **Standalone browser `card.state` unread/open parity**: Standalone WebSocket/REST card snapshots now preserve actor-scoped `cardState` in both plugin-backed and built-in fallback modes, and opening a card in the browser clears unread state through the shared explicit open flow.

- **Webhook plugin-options config parity**: `kl-plugin-webhook` now reads webhook registrations from `plugins["webhook.delivery"].options.webhooks` when configured (with legacy top-level `webhooks` fallback) and writes updates back into plugin options when the plugin config block exists; webhook docs were updated to match this behavior.

- **Webhook docs now match the plugin contract**: Regenerated `docs/webhooks.md` from slimmer source metadata aligned with `packages/kl-plugin-webhook/README.md`, corrected the delivered form event name to `form.submitted`, documented prefix wildcard subscriptions and the standalone `/api/webhooks/test` receiver, and added the missing after-events (`card.action.triggered`, board/card log events, and `storage.migrated`).

- **Workspace root no longer owns `kanban-lite` runtime packages**: Moved the monorepo root `dependencies` block into `packages/kanban-lite/package.json` so the workspace controller no longer relies on hoisted app dependencies and `kanban-lite` owns the packages it imports.

- **Published package now declares standalone/MCP runtime dependencies**: Added direct `kanban-lite` package dependencies for externalized runtime modules such as `@fastify/swagger`, `@fastify/swagger-ui`, `@modelcontextprotocol/sdk`, and `zod` so npm installs no longer rely on hoisted workspace/root dependencies.

- **Published npm package README restored**: Added a package-local `packages/kanban-lite/README.md` so npm shows installation and usage docs on the `kanban-lite` package page when publishing from the workspace package directory.

### Changed

- **Plugin enablement and configuration semantics**: Plugin management now consistently treats enablement as selected-provider state under `plugins[capability]`, uses provider-exported `optionsSchema()` metadata for configuration, and reuses the same redacted read model vocabulary across SDK, UI, CLI, REST API, and MCP.
- **Published package homepage now points to docs site**: Updated `packages/kanban-lite/package.json` and the npm-facing package README to send users to <https://borgius.github.io/kanban-lite/> for the main docs and quick start.

### Added

- **Full public `KanbanSDK` in plugin contexts**: CLI, standalone, and MCP plugin seams that expose `sdk` now advertise and pass the full public `KanbanSDK` instance, so plugin code can reuse host-auth-aware SDK methods directly instead of depending on narrowed helper facades.
- **`KanbanSDK.getConfigSnapshot()`**: Added a public SDK method that returns a cloned read-only snapshot of the current workspace config, giving plugins and advanced SDK consumers a safe way to inspect `.kanban.json` state without mutating live runtime objects.

- **`apiToken` option for `kl-plugin-auth` `auth.identity`**: When `auth.identity` is configured with `kl-plugin-auth`, an explicit `options.apiToken` value in `.kanban.json` is now used as the bearer-token secret, taking precedence over the `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` environment variables. When set in standalone mode, the server-start auto-generation pathway is skipped and no `.env` write occurs. A matching `createAuthIdentityPlugin(options)` factory is exported so the SDK plugin loader can create a configured instance with the pinned token at startup.
- **`basePath` config option for subfolder deployments**: The standalone server now reads `basePath` from `.kanban.json` (e.g. `"basePath": "/kanban"`). When set, all asset URLs, the WebSocket endpoint, and API routes are served under that prefix, enabling reverse-proxy setups where the board lives at a path like `https://example.com/kanban/` rather than the domain root.
- `customHeadHtml` and `customHeadHtmlFile` configuration options for injecting custom HTML into the standalone board's `<head>` element — useful for analytics, custom CSS, or guided tours
- **Implemented Aspida AQ-44182 demo workflow in code**: `examples/chat-sdk-vercel-ai-aspida` now seeds the richer AQ-44182 metadata/labels/comments described in the Aspida flow docs, supports shorthand case lookup plus existing-card updates in the chat route, adds the reusable `beneficiary-correction-check` form and custom rescue columns to the shipped demo workspace, and gives the Aspida action webhook deterministic side effects for `same-day-text-rescue`, `controlled-next-day-save`, and `Investigate beneficiary` linked-ticket creation.
- **CLI `card-state` parity commands**: The `kl` CLI now exposes `card-state status [id]`, `card-state open <cardId>`, and `card-state read <cardId>` so terminal workflows can inspect backend/default-actor status, fetch side-effect-free unread summaries, and trigger explicit SDK-backed open/read mutations with stable identity-error parity.
- **SQLite-backed `card.state` provider package**: `kl-plugin-card-state-sqlite` now ships a real first-party SQLite provider for actor-scoped unread/open state, including package docs plus cross-backend parity tests that prove the SDK keeps unread derivation, actor scoping, auth-absent default-actor behavior, and explicit read/open mutations aligned with the built-in file-backed backend.
- **Public SDK `card.state` read/open/read APIs**: `KanbanSDK` now exposes side-effect-free `getCardState()` / `getUnreadSummary()` reads plus explicit `markCardOpened()` / `markCardRead()` mutations, with unread derivation driven from persisted activity logs and actor resolution falling back to the stable default actor only when auth is absent.
- **Focused Aspida chat rescue demo**: `examples/chat-sdk-vercel-ai-aspida` now seeds a compact new business / NIGO rescue scenario, ships a single chat starter flow around the rescue case, keeps deterministic ticket-analysis hints plus the `request-info` / `notify-slack` / `escalate` actions, and includes live integration coverage for that focused workflow through real comment, form, and action mutations.
- **Workspace Slidev demo presentation agent**: Added `.github/agents/slidev-demo-presentation.agent.md`, a custom VS Code chat agent for creating polished, truthful Slidev demo decks from repo sources such as the IncidentMind / CorePilot live demo guide, with strong presenter notes, story-arc guidance, and Slidev-safe layout/validation rules.
- **IncidentMind Slidev demo deck**: Added `examples/chat-sdk-vercel-ai/INCIDENTMIND-COREPILOT-LIVE-DEMO.slides.md`, a presenter-ready Slidev deck that turns the CorePilot live demo guide into a polished, proof-focused presentation with explicit truth boundaries and full spoken speaker notes.
- **Webhook extension model parity**: `kl-plugin-webhook` is now documented as the owner of webhook CRUD/runtime delivery plus standalone, CLI, and MCP surfaces exposed through plugin seams. Advanced SDK consumers can use `sdk.getExtension('kl-plugin-webhook')`, while `KanbanSDK` keeps direct webhook methods as compatibility shims and the public MCP tool names remain unchanged.
- **Self-hosted Chat SDK example stack**: `examples/chat-sdk-vercel-ai` now launches its own local Kanban Lite instance with a dedicated `demo-workspace/.kanban.json`, prints both Kanban/chat URLs from `npm run dev` / `npm run start`, seeds demo cards with attached comments/forms/actions, and exposes a local action-webhook endpoint so card actions work during local development.

### Changed
- **Bundled plugin SDK/config read alignment**: `kl-plugin-auth` and `kl-plugin-webhook` now prefer equivalent public SDK methods and `sdk.getConfigSnapshot()` reads where available, while retaining direct plugin-owned persistence only for flows that still have no public SDK write equivalent.
- **Card-state docs/source parity**: Updated README, plugin deep-dive docs, SDK JSDoc, and OpenAPI metadata so they consistently describe the built-in file-backed `builtin` backend, the first-party SQLite backend package `kl-plugin-card-state-sqlite`, the stable auth-absent default actor contract, configured-identity failures as `identity-unavailable` / `ERR_CARD_STATE_IDENTITY_UNAVAILABLE`, and the distinction between actor-scoped unread/open state versus active-card UI state.
- **IncidentMind demo framing for CorePilot**: `examples/chat-sdk-vercel-ai` now presents IncidentMind as a fictional incident-operations layer built around free kanban-lite, keeps kanban-lite visibly central as the system of record, and updates chat/UI/README prompt examples to target the existing seeded cards plus stable `incident-report`, `release-checklist`, `notify-slack`, and `deploy` flows without overstating automation.

### Fixed
- **Lean unread activity metadata in card logs**: Persisted card-log `object.activity` payloads no longer duplicate card/board identifiers or event-specific fields that already exist in the surrounding log object or card context. Unread detection now uses the minimal `{ type, qualifiesForUnread }` marker while keeping top-level log metadata unchanged.
- **Open card live refresh after external events/actions**: The webview now rehydrates an already-open card when fresh card lists arrive over WebSocket, so API-added comments and other external mutations appear without manually reopening the drawer. Triggering a card action now also forces an immediate reload in both standalone and VS Code-hosted runtimes so webhook-driven updates show up right away.
- **Cross-window open-card log refreshes**: Standalone mode now tracks open cards per WebSocket client and fans out `cardContent` / `logsUpdated` refreshes to every window viewing the same card, so action-triggered log entries and log clears stay synchronized across multiple tabs or browser windows.
- **Standalone reconnect viewer recovery**: Browser tabs now replay their current board/card bootstrap messages after a standalone WebSocket reconnect, so a recovered second tab keeps receiving live `logsUpdated` / `cardContent` refreshes for the card that was already open before the socket dropped.
- **Built-in `card.state` fallback persistence**: The default `builtin` `card.state` provider now stores actor-scoped domain state and unread cursors in dedicated workspace sidecar files, restoring persisted state across SDK instances without leaking data into markdown card files or `.active-card.json`.
- **IncidentMind action follow-up behavior**: `examples/chat-sdk-vercel-ai` now makes `/api/action-webhook` persist deterministic board-side effects for supported actions — including `IncidentMind automation` comments, an escalation follow-up card for incident escalations, and truthful status moves for release/rollback flows — while the chat action tool returns the updated card state in the same turn.
- **Chat SDK example deploy approval truthfulness**: The `examples/chat-sdk-vercel-ai` action webhook now requires recorded release approval before a `deploy` action moves a card to `done`, the example tests cover both blocked and approved flows, and the README prompt guidance matches the shipped behavior.
- **Chat SDK example action webhook secret hardening**: `examples/chat-sdk-vercel-ai` no longer ships a predictable default action-webhook token. The launcher now generates a fresh per-run secret when `ACTION_WEBHOOK_SECRET` is unset, the Next.js route refuses missing or too-short secrets instead of falling back insecurely, the demo workspace config only carries a placeholder token in git, and the example tests/docs cover the safer local-only flow.
- **Sanitized example OpenAI env placeholder**: Replaced the committed `examples/chat-sdk-vercel-ai/.env` OpenAI credential with the safe `YOUR_OPENAI_API_KEY_HERE` placeholder while keeping the example's local env workflow intact.

### Changed
- **Chat SDK example agent workflows**: The Chat SDK / Vercel AI example now actively supports freeform card-specific comment, form-submission, and action-trigger requests in addition to create/list/move card operations, and the live integration suite now verifies those richer workflows.

### Changed
- **Coordinated release orchestration**: Root release commands now verify npm/GitHub auth up front, build each public package only once, bump every public package version without per-package git tags, publish all npm packages (including `kanban-lite`), create one release commit/tag, and upload or replace the matching GitHub VSIX asset. The `kanban-lite` VSIX packaging hook and the n8n package `prepack` hook now verify existing build output instead of triggering another rebuild.

### Removed
- **Core webhook runtime shims deleted**: `packages/kanban-lite/src/sdk/webhooks.ts` and `packages/kanban-lite/src/sdk/plugins/webhookListener.ts` (built-in compatibility shims) have been permanently removed along with their test file. The public `WebhookListenerPlugin` / `createWebhookListenerPlugin` re-exports are also removed from the SDK `index.ts`. `kl-plugin-webhook` is the sole source of webhook runtime delivery; without it, webhook CRUD methods throw a deterministic install error. The orphaned `Webhooks` OpenAPI tag and `Webhook` component schema have been removed from the standalone OpenAPI spec.

### Changed
- **Webhook fallback removal**: Core SDK (`KanbanSDK`) no longer owns built-in webhook runtime delivery or CRUD logic. When `kl-plugin-webhook` is not installed, webhook CRUD methods (`listWebhooks`, `createWebhook`, `updateWebhook`, `deleteWebhook`) throw a deterministic install error. `getWebhookStatus()` returns `'none'` instead of `'built-in'` when no plugin is active. Core standalone `/api/webhooks` routes and CLI help text for webhook commands have been removed; `kl-plugin-webhook` is the sole owner of these surfaces. The `webhook`/`wh` CLI alias shims are retained for discoverability.

### Added
- **Webhook plugin ownership documentation parity**: The root README, `packages/kl-plugin-webhook/README.md`, and generated webhook reference now describe `kl-plugin-webhook` as the owner of webhook runtime delivery, standalone `/api/webhooks` routes, and CLI `kl webhooks` commands where plugin seams exist, while MCP remains an intentional thin core facade.

### Changed
- **Webhook discovery/source-doc workflow docs**: Documentation now states that `webhookPlugin` configuration activates webhook package discovery for provider, standalone, and CLI surfaces, and that generated webhook docs must be regenerated from `scripts/generate-webhooks-docs.ts` instead of being edited by hand.

### Added
- **Chat SDK / Vercel AI example integration coverage**: `examples/chat-sdk-vercel-ai` now includes example-local Vitest integration tests that boot the standalone server against a temporary workspace, call the real chat route with an OpenAI model, and assert that card create/move operations mutate kanban state correctly.
- **Example-local placeholder env defaults for the Chat SDK app**: Added a placeholder-only local `.env` workflow plus `OPENAI_MODEL` support so the example can use shell-exported `OPENAI_API_KEY` values without forcing secrets into the repo.

### Fixed
- **Standalone source-mode browser UI loading**: Running the standalone server directly from source (for example via `tsx` in the Chat SDK example launcher) now resolves the built `dist/standalone-webview` assets correctly, so `/index.js` and `/style.css` are served as static files instead of falling back to the HTML shell and leaving the Kanban page blank in the browser.
- **Chat SDK example card workflow wording and reliability**: The chat route and UI now use card-centric tool naming, stronger tool-use instructions, a deterministic temperature setting, and more robust kanban API error handling so the example behaves more consistently under live integration tests.

### Added
- **Optional dynamic roles for local auth users**: Each user entry in `plugins["auth.identity"].options.users` may now carry any string `role`, backed by a shared `plugins["auth.identity"].options.roles` catalog that powers the settings picker. Local auth remains allow-authenticated by default; explicit `auth.policy.options.permissions[]` rules can enforce custom role-based permissions when needed.
- **Flexible `--role` flag for `kl auth create-user`**: The CLI command now accepts `--role <role>` for any role name, embeds it in the new user entry, and appends it to the local role catalog in `.kanban.json` when missing.
- **Session identity carries user roles**: After login, the session-backed `AuthIdentity` now includes the user's configured role in its `roles` array so that policy checks see the correct role on every request.

### Added
- **Examples discoverability refresh**: The stable `/docs/examples/` hub, quick-start guide, and root README now point more directly to the shipped Chat SDK / Vercel AI, LangGraph Python, and Mastra Agent Ops walkthroughs and their matching runnable example folders.
- **Plugin CLI command contributions**: Plugins can now contribute `kl` sub-commands by exporting a `cliPlugin` object satisfying the new `KanbanCliPlugin` SDK interface. The CLI reads active plugin package names from `.kanban.json` at startup, dynamically loads each package's `cliPlugin` export, and dispatches matching commands to the plugin. Unknown sub-commands of built-in namespaces (e.g. `kl auth`) also fall through to the plugin before erroring.
- **`kl auth create-user` command**: `kl-plugin-auth` now exports a `cliPlugin` that adds a `create-user` sub-command. Running `kl auth create-user --username alice --password s3cr3t` bcrypt-hashes the password and appends the user entry to `plugins["auth.identity"].options.users` in `.kanban.json`.
- **Top-level examples topology contract**: Added `examples/README.md` to reserve the canonical `chat-sdk-vercel-ai`, `langgraph-python`, and `mastra-agent-ops` example slugs, document self-contained local install/run expectations, and define placeholder-only `.env.example` conventions without enrolling `examples/*` into the root workspace.
- **Standalone plugin HTTP integration hooks**: Active plugin packages can now contribute standalone-only request middleware and HTTP routes, allowing features such as plugin-owned login pages and cookie-backed auth flows without introducing a separate user-facing config namespace.
- **Local auth provider with standalone login flow**: `kl-plugin-auth` now ships a first-party `local` auth provider pair plus standalone `/auth/login` / `/auth/logout` handling. Browser requests redirect to the plugin-served login page when unauthenticated, standalone API requests accept authenticated cookies or bearer tokens, and CLI/MCP can use the shared workspace token.
- **Workspace API token bootstrap**: The standalone local auth flow now creates `KANBAN_LITE_TOKEN=kl-...` in `<workspaceRoot>/.env` when missing, making the same token available to standalone API, CLI, and MCP clients.
- **First-party n8n integration package**: Added `n8n-nodes-kanban-lite`, which ships a `Kanban Lite` app node plus a `Kanban Lite Trigger` node for n8n community/private-node installs.
- **Dual n8n transport modes**: The new n8n integration supports both remote standalone-server API transport and same-machine local SDK transport, with the app node covering boards, cards, columns, comments, attachments, labels, settings, storage, forms, webhooks, workspace info, and auth status.
- **Transport-aware n8n trigger coverage**: n8n trigger subscriptions now follow the SDK event catalog parity rules: local SDK mode can observe before- and after-events, while remote API mode receives committed after-events only via webhook registration.
- **Docs-site authored pages**: Added homepage with hero section, trust strip, persona grid, and interface comparison grid; a quick-start guide; dedicated feature guides for cards, search, and boards; a comprehensive FAQ page; a product tour; and an examples reference page. All authored content lives under `packages/docs-site/src/` as Nunjucks/Markdown templates. Root docs remain the source of truth for all reference content.
- **Docs-site package scaffold**: Added `packages/docs-site` as a private Eleventy 3 workspace package with `eleventy.config.mjs`, `site:build` / `site:dev` root scripts, passthrough asset pipeline, and a `README.md` covering local development and the content model.
- **Docs-site content pipeline and navigation layer**: Added global data (`site.js`, `nav.js`, `docsContent.js`) and a `renderMarkdown` filter to `packages/docs-site` that read existing root markdown sources (`docs/*.md`, `README.md`, `CHANGELOG.md`) without relocating them. Implemented shared `docs.njk` layout with sidebar, `sitenav.njk` include, and ten reference doc pages (`/docs/sdk/`, `/docs/api/`, `/docs/cli/`, `/docs/mcp/`, `/docs/plugins/`, `/docs/forms/`, `/docs/webhooks/`, `/docs/auth/`, `/docs/quick-start/`, `/docs/`). Static `docs/images/*` are passthrough-copied into the site output. All layouts and navigation are CSS-only with no client-side JavaScript.

### Added
- **External auth provider install story**: The auth provider ids `noop` and `rbac` now resolve through the standalone `kl-plugin-auth` package, and the local-dev loader also supports the sibling-repo pattern at `../kl-plugin-auth` so linked-package verification matches the webhook-plugin workflow.
- **External webhook provider install story**: Webhook delivery now supports the `webhook.delivery` provider id `webhooks`, which resolves to the standalone `kl-plugin-webhook` package. The local-dev loader also supports the sibling-repo pattern at `../kl-plugin-webhook`, so linked-package verification matches the existing storage-plugin workflow.
- **EventEmitter2-based pub/sub event bus**: `KanbanSDK` now uses an internal `EventBus` (wrapping EventEmitter2 with wildcard routing) for all event dispatch, replacing the single-callback `onEvent` pattern with a scalable pub/sub architecture.
- **`SDKEvent<T>` typed event envelope**: All bus events are wrapped in a typed envelope carrying `type`, `data`, `timestamp`, and optional `actor`, `boardId`, and `meta` fields.
- **`EventListenerPlugin` interface**: New plugin contract (`event.listener` capability) for event subscriber plugins that can subscribe to SDK events via the bus.
- **`WebhookListenerPlugin`**: Webhooks are now delivered via an `EventListenerPlugin` that subscribes to all SDK events on the bus instead of being called directly from the emit path.
- **Auth events on the bus**: `auth.allowed` and `auth.denied` events are emitted from `_authorizeAction` after every authorization decision.
- **`eventBus` getter on `KanbanSDK`**: Exposes the SDK event bus for custom subscriptions (e.g. `sdk.eventBus.on('task.*', handler)`).
- **`destroy()` method on `KanbanSDK`**: Tears down the event bus and all listener plugins, complementing the existing `close()` method.
- **Built-in RBAC auth provider**: Kanban Lite now ships a first-party `rbac` provider pair for `auth.identity` and `auth.policy`. Enable it in `.kanban.json` under `auth` to enforce a fixed three-role action matrix (`user` → `manager` → `admin`) without any login flow or external identity service. The RBAC provider validates opaque host-supplied tokens against a runtime-owned principal registry, then resolves subject and role from that runtime material rather than token text. Scope is deliberately limited to action-level authorization only: no row filtering, no interactive login, and no browser execution are included in this release. Workspaces without auth configured remain fully open-access (noop default is unchanged). Token values, token-to-role maps, and role assignments are never persisted to `.kanban.json` or echoed in error bodies, logs, or API responses.
- **SDK auth seam coverage for all admin/config mutators**: All remaining board, column, label, settings, webhook, migration, and default-board SDK methods now pass through `_authorizeAction()` before side effects, closing the previously uncovered admin action surface.
- **Host parity for admin/config auth**: Standalone REST routes, WebSocket mutation paths, CLI admin commands, MCP tools, and the VS Code extension host all propagate auth context to the newly protected SDK methods and map `AuthError` to appropriate denial responses.
- **Auth/authz Stage 2 parity**: The remaining privileged async SDK mutation methods now participate in the shared pre-action auth seam, standalone `/api/auth`, CLI `auth status`, and MCP `get_auth_status` expose `getAuthStatus()`-based diagnostics, and the VS Code extension host now stores its token in `SecretStorage` while keeping raw credentials out of webview messages.
- **Local MinIO attachment integration path**: Installed the published `kl-plugin-attachment-s3` package into the main repo, added a repo-local `docker-compose.yml` MinIO stack with bucket bootstrap, and added `test:integration:minio` for real SDK coverage against the external attachment engine.
- **Optional attachment append hook**: `attachment.storage` providers may now expose an `appendAttachment(...)` capability for append-heavy workloads such as card logs. The SDK uses it opportunistically and falls back to a safe rewrite path when the provider does not support native append.
- **Developer S3 attachment provider scaffold**: Added `tmp/kl-plugin-attachment-s3`, a standalone example package for an external `attachment.storage` provider backed by Amazon S3 or compatible APIs. This package is separate from the built-in `kanban-lite` providers and is documented for local/developer use.
- **Auth/authz plugin contract slice (no-op)**: Introduced two new capability namespaces — `auth.identity` and `auth.policy` — using the existing plugin/capability architecture. Both default to built-in `noop` providers that preserve all current open-access behavior (anonymous identity, allow-all policy). Defines `AuthIdentityPlugin`, `AuthPolicyPlugin`, `AuthIdentity`, and `AuthPluginManifest` interfaces; exports `NOOP_IDENTITY_PLUGIN` and `NOOP_POLICY_PLUGIN` singletons; adds `normalizeAuthCapabilities()` in `shared/config.ts`; and makes `resolveCapabilityBag()` accept an optional `authCapabilities` parameter that defaults to noop. No enforcement or login UX is implemented in this slice.
- **Auth capability contract wiring fixes**: `KanbanSDK` now reads `auth` from `.kanban.json` via `normalizeAuthCapabilities()` and passes the resolved auth capabilities into `resolveCapabilityBag()`, so user-configured `auth.identity` / `auth.policy` providers take effect at construction time. Architecture plan docs updated to the canonical `auth.identity` / `auth.policy` namespace ordering. README documents the no-op-by-default behavior and configuration shape for future plugin authors.
- **Partial `formData` and `${path}` placeholder interpolation in form defaults**: Stored `formData` entries may now be partial at rest. During form preparation, string values in config defaults, attachment defaults, and persisted per-form data are scanned for `${path}` placeholders and resolved against full card context (`id`, `boardId`, `status`, `priority`, `assignee`, `dueDate`, `metadata.*`). Unresolved placeholders become empty strings; metadata overlay still wins last. REST, CLI, MCP, and extension submit paths inherit this behavior automatically through the SDK without new request shapes.
- **Installable storage-plugin authoring skill**: Added the `kanban-storage-plugin-author` skills.sh-compatible skill for generating third-party kanban-lite storage plugin npm packages, including bundled contract references and starter templates.
- **Card forms across all surfaces**: Cards can now attach reusable workspace forms from `.kanban.json` or inline card-local forms, render them as dedicated webview tabs, and submit validated payloads via the SDK, REST API, CLI, and MCP.
- **`form.submit` webhook event**: Successful form submissions now emit a first-class `form.submit` event with board, card, resolved form descriptor, and persisted payload context.
- **Capability-based storage config**: `.kanban.json` now supports `plugins["card.storage"]` and `plugins["attachment.storage"]` provider selections alongside the legacy storage fields.
- **MySQL compatibility card provider**: Added the `mysql` `card.storage` compatibility provider path with lazy optional `mysql2` runtime loading and clear install guidance when the driver is missing.
- **Provider metadata surfaces**: Storage status in the SDK, REST API, CLI, and MCP now reports resolved card/attachment provider ids plus `isFileBacked` and `watchGlob` support metadata.
- **Active card lookup**: Added `getActiveCard(boardId?)` to the SDK plus matching REST API, CLI, and MCP support for retrieving the currently active/open card tracked by the UI.
- **Persisted minimized columns**: Minimized column state is now saved to `.kanban.json` per board (`minimizedColumnIds`), surviving extension reloads and panel restores. SDK exposes `getMinimizedColumns(boardId?)` and `setMinimizedColumns(columnIds, boardId?)`; REST `PUT /api/columns/minimized`; CLI `kl columns set-minimized <id...>`; MCP `set_minimized_columns` tool.
- **Configurable card panel layout**: Added the `panelMode` setting to switch card creation and detail flows between a right-side drawer and a centered popup.
- **Adjustable drawer width**: Added the `drawerWidth` setting (20–80%) so drawer mode can be tuned per workspace; board layout and card visibility calculations now respect the configured width.
- **Clickable label filters**: Clicking a label on a board card or in the card detail panel now applies that label as the active board filter.
- **Metadata-aware fuzzy search parity**: Added the web UI `Fuzzy` toggle, metadata filter buttons in rendered metadata fields, CLI `kl list --search ... --fuzzy`, REST `q` / `fuzzy` task-list parameters, and MCP `list_cards` `searchQuery` / `fuzzy` inputs with shared metadata-aware semantics.
- **Explicit sqlite/mysql attachment compatibility providers**: `attachment.storage` now supports first-class `sqlite` and `mysql` compatibility-provider selections when explicitly chosen, while omitted configs still keep the legacy `localfs` default.

### Changed
- **Canonical CLI/MCP token env name**: CLI and MCP now prefer `KANBAN_LITE_TOKEN` as the canonical workspace API token variable while still accepting `KANBAN_TOKEN` as a compatibility alias.
- **Auth before-event execution model**: Request auth is now carried through scoped `runWithAuth(...)` execution instead of `_withAuthContext()` / payload-carried auth, and first-party auth listeners resolve identity from that scoped carrier rather than `BeforeEventPayload.auth`.
- **Before-event input merge semantics**: `_runBeforeEvent()` now owns immutable deep-merge behavior for listener overrides while preserving the original mutation input when listeners return no effective changes.
- **Plugin runtime model (breaking for plugin authors)**: `KanbanSDK` now owns async before-event dispatch and post-commit after-event emission. Runtime auth/webhook integrations are listener-only (`register` / `unregister`) rather than legacy direct runtime seams, while end-user denial behavior and webhook delivery timing remain consistent across SDK, CLI, MCP, standalone, and extension-host flows.
- **Webhook compatibility behavior**: Existing `.kanban.json` webhook registrations stay in the top-level `webhooks` array with no migration required. After the extraction, webhook CRUD and runtime delivery require `kl-plugin-webhook`; core no longer provides a built-in fallback path.
- **Refreshed card detail view**: The card editor now uses a calmer desktop-first popup/drawer presentation with tighter control density, smaller type and surface rhythm on large screens, and cleaner attachment/comment composition across desktop and mobile layouts.
- **Swagger-backed REST API docs pipeline**: `docs/api.md` is now generated from the standalone OpenAPI spec used by Fastify Swagger, and the standalone server exposes interactive API docs at `/api/docs` plus raw OpenAPI JSON at `/api/docs/json`.
- **Core sqlite/mysql provider boundary**: `markdown` and `localfs` are now the only true built-ins in core. The provider ids `sqlite` and `mysql` remain supported as compatibility aliases that resolve to `kl-plugin-storage-sqlite` and `kl-plugin-storage-mysql`, and core test coverage now focuses on host/plugin contracts rather than provider-owned CRUD/schema behavior.
- **Workspace-local env loading for plugins**: `KanbanSDK` now loads `<workspaceRoot>/.env` before resolving capability plugins, so local MinIO/S3 defaults work without manually exporting variables in each shell.
- **Form submission audit logs**: Successful form submissions now append a system card log entry containing the submitted payload (`payload`) plus `formId` and `formName`, so the exact submitted body is visible from the card logs UI and SDK log surfaces.
- **Form display metadata**: Reusable workspace forms now support `name` and `description` fields. `name` defaults to a capitalized form key, `description` defaults to an empty string, card tabs render as `form: <Form Name>`, and the form header shows the resolved description when provided.
- **Generated SDK and REST docs**: Expanded the source JSDoc and API route metadata with clearer behavior notes, richer examples, attachment/upload guidance, and storage/form semantics so regenerated `docs/sdk.md` and `docs/api.md` are more useful for integrators.
- **Polished card form UI**: The card form tab now renders with consistent spacing, theme-aware input and label styles, and clear validation-state indicators in both standalone and VS Code webview runtimes.
- **Legacy storage compatibility**: `storageEngine` / `sqlitePath` continue to work as compatibility aliases, but per-namespace `plugins[...]` entries now take precedence and `attachment.storage` falls back to `localfs` when omitted.
- **Plugin-owned core storage internals**: Core markdown/localfs storage now lives exclusively under `src/sdk/plugins/*`, and the legacy `src/sdk/storage/*` layer no longer owns engine classes or a parallel factory path.
- **Plugin-only storage internals**: The obsolete `src/sdk/storage` directory has been removed, and the shared engine contract now lives under `src/sdk/plugins/types.ts` alongside the plugin-owned engine implementations.
- **Standalone URL sync**: Browser history and deep links now persist the fuzzy-search state alongside the existing board, card, tab, filter, and search query routing state.

### Fixed
- **Horizontal column drag-and-drop**: Column reordering in row layout now keeps working in the webview even when the runtime only exposes standard drag payloads, thanks to more resilient column-drag detection and fallback handling.
- **Row-layout reorder highlight parity**: Column reordering now uses the correct axis and shows top/bottom drop-border highlights in vertically stacked row layout, matching the visual affordance available in side-by-side lane layout.
- **Provider cleanup follow-through**: Removed the lingering core-owned SQLite/MySQL implementation internals from `src/sdk/plugins/sqlite.ts` and `src/sdk/plugins/mysql.ts`, and replaced `src/sdk/__tests__/storage-sqlite.test.ts` with a host-boundary alias test so SQLite/MySQL implementation and CRUD/schema coverage live only in external provider packages; core now relies solely on the compatibility-alias plugin boundary.
- **Remote attachment providers now support card log files**: Card logs no longer require a provider-owned local attachment directory. The SDK now reads and writes `<cardId>.log` through the active `attachment.storage` capability, so S3/MinIO-backed attachment providers work for logs as well as manual file attachments.
- **Migration config cleanup for sqlite/mysql attachment compatibility providers**: Migrating from SQLite back to markdown now removes incompatible `attachment.storage: sqlite/mysql` overrides so reopened workspaces fall back cleanly to the legacy `localfs` attachment default.

- **Standalone watcher refreshes**: The standalone server now honors capability-provided watch globs without filtering refresh events to `.md` files only, so file-backed storage plugins can trigger board refreshes correctly.
- **ESM SDK plugin loading**: The published ESM SDK build now resolves lazy MySQL driver loads and external storage plugins through an ESM-safe runtime loader, preserving actionable install/validation errors instead of crashing with `Dynamic require` failures.
- **Attachment provider serving**: The standalone server now asks the active attachment capability to safely resolve or materialize files instead of assuming every served attachment must live under `.kanban`.
- **Minimized column drops**: Card drags now reach minimized-column rails correctly instead of being swallowed by the rail's column-reorder wrapper.
- **Standalone reconnect recovery**: In standalone/browser mode, the app now automatically retries same-page backend reconnects when possible and shows an in-app connection-lost error with refresh/reopen guidance if recovery cannot be restored.
- **Toolbar search chips**: Mixed search queries in the web UI now render separate removable chips for plain-text terms and each `meta.*` token, so individual constraints can be cleared without wiping the entire query.

### Removed
- **Legacy webview build path**: Deleted `src/webview/main.tsx`, `src/webview/index.html`, and `vite.config.ts` — these produced `dist/webview/` which was unused since the dual-runtime `standalone-shim.ts` design was introduced. The active build path (`vite.standalone.config.ts` → `dist/standalone-webview/`) is unchanged.
- **npm scripts**: Removed `build:webview` and `watch:webview`; the `watch` aggregate script now uses `watch:standalone-webview`.

### Added
- **Board logs**: Each board now has its own log file at `.kanban/boards/<boardId>/board.log` for board-level audit trail entries. Board logs share the same `LogEntry` format as card logs (timestamp, source, text, optional JSON object) but are not tied to any card.
- **SDK**: `getBoardLogFilePath(boardId?)`, `listBoardLogs(boardId?)`, `addBoardLog(text, options?, boardId?)`, `clearBoardLogs(boardId?)` methods on `KanbanSDK`. Emits `board.log.added` and `board.log.cleared` events.
- **REST API**: `GET /api/boards/:boardId/logs`, `POST /api/boards/:boardId/logs`, `DELETE /api/boards/:boardId/logs`
- **CLI**: `kl board-log list`, `kl board-log add --text <msg> [--source <src>] [--object <json>]`, `kl board-log clear`
- **MCP**: `list_board_logs`, `add_board_log`, `clear_board_logs` tools
- **UI**: Board logs button (scroll icon) in the toolbar that opens a side panel reusing the existing `LogsSection` component; supports clear and real-time updates via WebSocket

### Added
- **Board actions**: Boards can now define named actions in `.kanban.json` as `boards.<id>.actions: Record<string, string>` (key → display title). Actions appear in an "Actions" dropdown in the board toolbar and fire `board.action` webhook events (payload: `boardId`, `action` key, `title`) when triggered.
- **SDK**: `getBoardActions(boardId?)`, `addBoardAction(boardId, key, title)`, `removeBoardAction(boardId, key)`, `triggerBoardAction(boardId, actionKey)` methods on `KanbanSDK`
- **REST API**: `GET/POST /api/boards/:boardId/actions`, `PUT /api/boards/:boardId/actions/:key`, `DELETE /api/boards/:boardId/actions/:key`, `POST /api/boards/:boardId/actions/:key/trigger`
- **CLI**: `kl board-actions [list|add|remove|fire] --board <id> [--key <key>] [--title <title>]`
- **MCP**: `list_board_actions`, `add_board_action`, `remove_board_action`, `trigger_board_action` tools
- **UI**: "Actions" dropdown button (⚡) in board toolbar; only visible when the current board has actions defined

### Added
- **URL routing** (standalone mode): The standalone web server now reflects navigation state in the browser URL using [TanStack Router](https://tanstack.com/router/latest). URL format: `/<boardId>/<cardId>/<tabId>?priority=&labels=&assignee=&dueDate=&q=`. Reloading the browser restores the same board, open card, active tab, and all active filters. Browser history entries are created for board/card/tab changes; filter-only changes use `history.replaceState`.

### Changed
- **Card actions**: `actions` field now accepts either an array of action keys (`string[]`) or an object mapping action keys to display titles (`Record<string, string>`). The "Run Action" dropdown shows the title when the object form is used; the action key is always what's sent to the webhook. Fully backward-compatible — existing array-form cards are unchanged.

### Added
- **Card logs**: Append timestamped log entries to any card, stored as a `<cardId>.log` text file auto-added as an attachment. Each entry has timestamp (auto-generated), source label (defaults to `"default"`), markdown text, and optional structured data object (stored as compact JSON). Supports markdown formatting (bold, italic, emoji) in log text.
- **SDK**: `listLogs(cardId, boardId?)`, `addLog(cardId, text, options?, boardId?)`, `clearLogs(cardId, boardId?)` methods on `KanbanSDK`
- **REST API**: `GET /api/tasks/:id/logs`, `POST /api/tasks/:id/logs`, `DELETE /api/tasks/:id/logs`
- **CLI**: `kl log list <id>`, `kl log add <id> --text <msg> [--source <src>] [--object <json>]`, `kl log clear <id>`
- **MCP**: `list_logs`, `add_log`, `clear_logs` tools
- **UI**: Logs tab in card editor with toolbar (clear, limit, order, source filter, show/hide toggles for timestamp/source/objects), YAML-rendered objects
- **Attachments subfolder**: attachments for the markdown storage engine are now stored in an `attachments/` subdirectory inside each column folder (e.g. `.kanban/boards/default/backlog/attachments/`) instead of alongside the card `.md` files
- **Browser-viewable attachments**: PDFs and other binary attachments now open with the OS/browser default viewer in the VS Code extension; the standalone server now serves PDF, JPEG, GIF, WebP, CSV, plain-text, and XML attachments with correct `Content-Type` headers so browsers render them inline in a new tab
- **KanbanSDK.getAttachmentDir(cardId, boardId?)**: new public SDK method that returns the absolute path to the attachment directory for a card (delegates to the active storage engine)
- **Pluggable storage engine**: new `StorageEngine` interface (`src/sdk/storage/types.ts`) decouples all card I/O from the SDK business logic
- **SQLite storage engine**: `SqliteStorageEngine` stores cards and comments in a single `.kanban/kanban.db` file using `better-sqlite3`; config (boards, columns, labels, webhooks) always stays in `.kanban.json`
- **Markdown storage engine**: `MarkdownStorageEngine` wraps the existing file-based I/O, unchanged default behavior
- **Storage engine configuration**: `storageEngine` (`"markdown"` | `"sqlite"`) and `sqlitePath` fields in `.kanban.json`
- **KanbanSDK.migrateToSqlite(dbPath?)**: migrates all markdown cards to SQLite and updates `.kanban.json`
- **KanbanSDK.migrateToMarkdown()**: migrates all SQLite cards back to markdown files and updates `.kanban.json`
- **KanbanSDK.close()**: releases storage engine resources (e.g. closes SQLite DB connection)
- **KanbanSDK.storageEngine** getter: exposes the active `StorageEngine` instance
- **CLI storage commands**: `kl storage status`, `kl storage migrate-to-sqlite [--sqlite-path <path>]`, `kl storage migrate-to-markdown`
- **REST API storage endpoints**: `GET /api/storage`, `POST /api/storage/migrate-to-sqlite`, `POST /api/storage/migrate-to-markdown`; `/api/workspace` now includes `storageEngine` and `sqlitePath`
- **MCP storage tools**: `get_storage_status`, `migrate_to_sqlite`, `migrate_to_markdown`
- **Storage engine tests**: `storage-markdown.test.ts` (10 tests), `storage-sqlite.test.ts` (15 tests), `storage-migration.test.ts` (5 tests)

### Changed
- `src/standalone/server.ts`: chokidar file watcher is skipped when the active storage engine is `sqlite` (no `.md` files to watch)
- **Multi-select cards**: Cmd/Ctrl+click to toggle individual cards, Shift+click to select a range, "Select All" in column menu
- **Bulk actions bar**: floating toolbar when multiple cards are selected with Move to, Priority, Assign, Labels, and Delete actions
- Multi-card drag & drop to move selected cards to another column
- `kl mcp` CLI command — starts the MCP server over stdio, allowing `kanban-lite` to be used as the `command` in MCP client config (e.g. `npx kanban-lite mcp`)

### Changed
- Renamed all internal "Feature" terminology to "Card" across the entire codebase (types, functions, variables, components, CLI, MCP, REST API, extension commands)
- `FeatureCard` component → `CardItem`, `FeatureEditor` → `CardEditor`, `CreateFeatureDialog` → `CreateCardDialog`, `FeatureHeaderProvider` → `CardHeaderProvider`
- `featuresDir` → `kanbanDir` throughout SDK, CLI, standalone server, and MCP server
- `KANBAN_FEATURES_DIR` env var → `KANBAN_DIR` (old name kept as fallback alias)
- VS Code command `kanban-lite.addFeature` → `kanban-lite.addCard`
- Zustand store: `features` → `cards`, `setFeatures` → `setCards`, `addFeature` → `addCard`, etc.
- All WebSocket/extension message types updated (`createFeature` → `createCard`, etc.)

## [2.1.0] - 2026-02-27

### Added
- Board and card detail zoom settings with slider UI (75–150%) stored in `.kanban.json`
- Keyboard shortcuts for adjusting board/card zoom level (Ctrl/Cmd `+`/`-`)
- CSS custom properties (`--board-zoom`, `--card-zoom`) with `calc()` multipliers for smooth font scaling
- Smooth scrolling to the selected feature card in the kanban board
- Sorting options in the column context menu
- Default zoom level configuration for both board and card detail views

## [2.0.0] - 2026-02-26

### Added
- Per-card actions (named string labels) that trigger a global `actionWebhookUrl` via `POST` on demand
- Run Actions dropdown in the card editor and action input in CreateFeatureDialog
- `triggerAction` method in KanbanSDK with full support across REST API, WebSocket, MCP (`trigger_action` tool), and CLI (`--actions` flag)
- Comment editor component with Write / Preview tabs and a markdown formatting toolbar
- GitHub-style comment editing using the new CommentEditor in CommentsSection
- Settings panel split into three tabs: **General**, **Defaults**, and **Labels**
- `version` field on card frontmatter schema for format tracking
- Metadata filtering for card list/search operations across all interfaces
- Creation and modification date display with hover tooltips on FeatureCard and FeatureEditor
- Sort order filter for card queries

### Fixed
- `version` field now included in all FeatureFrontmatter constructions in the server

## [1.9.0] - 2026-02-25

### Added
- Card metadata support — arbitrary key-value data stored as a native YAML block in frontmatter (`metadata` field)
- Metadata UI: key-count chip `{N}` on card grid and collapsible tree view in the card detail panel
- Label definitions with color picker in the Settings panel (create, rename, delete labels)
- Colored labels rendered on cards, in the editor, create dialog, and toolbar
- Label group filtering across SDK (`filterCardsByLabelGroup`), CLI (`--label-group`), REST API, and MCP tools
- SDK label management methods: `getLabels`, `setLabel`, `renameLabel`, `deleteLabel`
- Soft-delete support: hidden **Deleted** column with per-card restore or permanent delete
- Purge deleted cards functionality to permanently remove all soft-deleted cards
- `--metadata` flag for CLI `create` and `edit` commands (accepts JSON string)
- Metadata support in MCP `create_card` and `update_card` tools
- Metadata support in REST API create/update routes
- Workspace info section in the Settings panel showing project path and `.kanban.json` parameters
- `js-yaml` dependency for robust YAML metadata parsing

### Fixed
- Comment parser no longer breaks on horizontal rules (`---`) inside comment blocks
- Blank lines in metadata YAML parsed correctly; scalar edge cases handled

## [1.8.0] - 2026-02-24

### Added
- Multi-board support: board selector dropdown to switch between boards and create new boards
- Card transfer between boards via a StatusDropdown with a nested board-and-column tree
- `transferCard` message type and `BoardInfo.columns` field in the extension/standalone protocol
- Webhooks system: CRUD operations (`create`, `get`, `update`, `delete`, `list`) stored in `.kanban-webhooks.json`
- Webhook event delivery on card create/update/delete/move with configurable `url`, `events`, and `secret`
- Webhook management commands in CLI and MCP server
- Comments functionality: add, edit, and delete comments on feature cards
- Markdown rendering for comment content
- Auto-generated SDK docs (`docs/sdk.md`) and REST API docs (`docs/api.md`) from JSDoc / route metadata
- `npm run docs` script to regenerate all documentation
- Theme toggle (light / dark) in the board toolbar
- Release scripts for versioning, changelog generation, and GitHub release creation

### Fixed
- SDK export paths updated to support both CommonJS and ESM module formats
- SDK import paths corrected; server feature loading logic improved

## [1.7.0] - 2026-02-20

### Added
- Settings button in the toolbar to quickly open extension settings
- Markdown editor mode for opening features in the native VS Code editor
- Kanban skill installation instructions to README

### Changed
- Replaced PNG icons with SVG versions for better quality and smaller file size

## [1.6.4] - 2026-02-20

### Changed
- Added new SVG icon and updated PNG icon

## [1.6.3] - 2026-02-19

### Added
- Allow saving features without a title (falls back to description)

### Fixed
- Activity bar incorrectly opening on ALT key press

## [1.6.2] - 2026-02-19

### Fixed
- Removed incorrect `fontSize` configuration from KanbanPanel

## [1.6.1] - 2026-02-19

### Fixed
- Focus must leave the webview before `focusMenuBar` works (VS Code limitation)

## [1.6.0] - 2026-02-14

### Added
- Undo delete functionality with a stack-based history
- Rich text editor in the CreateFeatureDialog

## [1.5.0] - 2026-02-14

### Added
- Keyboard shortcut for saving and closing the CreateFeatureDialog

## [1.4.0] - 2026-02-14

### Added
- File name display on cards with a toggle setting

## [1.3.0] - 2026-02-13

### Added
- Automatic cleanup of empty old status folders during board updates
- CONTRIBUTING.md guide for new contributors

## [1.2.0] - 2026-02-13

### Added
- `completedAt` frontmatter field that records when a feature was marked as done, displayed as relative time on cards (e.g. "completed 2 days ago")

### Changed
- Simplified status subfolders to use only a `done` folder instead of per-status folders

### Dependencies
- Bumped `qs` from 6.14.1 to 6.14.2

## [1.1.0] - 2026-02-13

### Added
- Open file button in editor to quickly jump to the underlying markdown file ([#19](https://github.com/LachyFS/kanban-lite/issues/19))
- External change detection in editor — reloads content when the file is modified outside the extension ([#19](https://github.com/LachyFS/kanban-lite/issues/19))

### Fixed
- CRLF line endings no longer break markdown frontmatter parsing ([#20](https://github.com/LachyFS/kanban-lite/issues/20))
- Order collisions when deleting features in KanbanPanel ([0f11a00](https://github.com/LachyFS/kanban-lite/commit/0f11a00))

### Changed
- Removed delete button from feature cards for a cleaner card layout ([086e738](https://github.com/LachyFS/kanban-lite/commit/086e738))

### Thanks
- [@hodanli](https://github.com/hodanli) for requesting the open file button and external change detection ([#19](https://github.com/LachyFS/kanban-lite/issues/19)), and reporting the CRLF line ending bug ([#20](https://github.com/LachyFS/kanban-lite/issues/20))

## [1.0.0] - 2026-02-12

### Added
- Sidebar view for Kanban board in the activity bar ([#9](https://github.com/LachyFS/kanban-lite/issues/9))
- Drag-and-drop card reordering within columns ([#16](https://github.com/LachyFS/kanban-lite/issues/16))
- Label management with suggestions in CreateFeatureDialog and FeatureEditor ([#4](https://github.com/LachyFS/kanban-lite/issues/4))
- `showLabels` setting to toggle label visibility on cards and in editors
- Assignee input with suggestions in feature creation and editing
- Due date and label fields in feature creation dialog
- "Build with AI" feature toggle (`showBuildWithAI` setting) that respects `disableAIFeatures` ([#5](https://github.com/LachyFS/kanban-lite/issues/5))
- Status subfolders support with automatic migration of existing feature files ([#3](https://github.com/LachyFS/kanban-lite/issues/3))
- Auto-save functionality in FeatureEditor

### Fixed
- Broken label selector in edit view
- `n` hotkey no longer triggers when modifier keys are held ([#7](https://github.com/LachyFS/kanban-lite/issues/7))
- Alt key no longer blocked from opening the menu bar ([#8](https://github.com/LachyFS/kanban-lite/issues/8))
- Missing activation event for sidebar webview ([#14](https://github.com/LachyFS/kanban-lite/issues/14))
- Date selection no longer rendered off-screen ([#10](https://github.com/LachyFS/kanban-lite/issues/10))
- Input handling now correctly ignores contentEditable elements
- Due date hidden on cards with "done" status ([#17](https://github.com/LachyFS/kanban-lite/issues/17))

### Changed
- Removed QuickAdd functionality in favor of the full CreateFeatureDialog
- Consistent card height across all columns
- Replaced `Buffer` with `TextEncoder` for file writing (browser compatibility)
- Replaced Node `fs` module with `vscode.workspace.fs` for file operations (virtual filesystem support)

### Thanks
- [@ungive](https://github.com/ungive) for requesting the sidebar view ([#9](https://github.com/LachyFS/kanban-lite/issues/9)) and card reordering ([#16](https://github.com/LachyFS/kanban-lite/issues/16)), and reporting numerous bugs around hotkeys ([#7](https://github.com/LachyFS/kanban-lite/issues/7)), activation ([#14](https://github.com/LachyFS/kanban-lite/issues/14)), date rendering ([#10](https://github.com/LachyFS/kanban-lite/issues/10), [#17](https://github.com/LachyFS/kanban-lite/issues/17)), and the menu bar ([#8](https://github.com/LachyFS/kanban-lite/issues/8))
- [@hodanli](https://github.com/hodanli) for requesting label management from the UI ([#4](https://github.com/LachyFS/kanban-lite/issues/4)) and status subfolders for done items ([#3](https://github.com/LachyFS/kanban-lite/issues/3))

## [0.1.6] - 2026-02-09

### Added
- Live settings updates: webview now instantly reflects VS Code setting changes without reopening
- Configuration change listener for KanbanPanel (columns, display settings, defaults)
- Configuration change listener for FeatureHeaderProvider (features directory re-evaluation)

### Fixed
- File watcher now properly disposes when features directory setting changes

## [0.1.5] - 2026-02-09

### Fixed
- VS Code configuration settings (columns, priority badges, assignee, due date, compact mode, default priority/status) now correctly propagate to the webview ([#2](https://github.com/LachyFS/kanban-lite/issues/2))
- Quick add input uses configured default priority instead of hardcoded value
- Create feature dialog uses configured default priority and status

### Changed
- Removed obsolete macOS entitlements and icon files from the build directory

### Thanks
- [@hodanli](https://github.com/hodanli) for reporting the priority badges settings bug ([#2](https://github.com/LachyFS/kanban-lite/issues/2))

## [0.1.4] - 2026-01-29

### Added
- Pressing `enter` in the title input field moves cursor to the description textarea, `shift-enter` creates a new line

### Fixed
- Prevent opening new feature panel when editing an existing feature with `n` hotkey
- Use `resourceLangId` instead of hardcoded path for kanban-lite command ([#1](https://github.com/LachyFS/kanban-lite/issues/1))
- Remove hardcoded devtool resource path for `editor/title/run` menu item ([#1](https://github.com/LachyFS/kanban-lite/issues/1))
- Removed redundant tile heading in edit view UI, (title is already visible in markdown editor)

### Thanks
- [@SuperbDotHub](https://github.com/SuperbDotHub) for reporting the features directory path bug ([#1](https://github.com/LachyFS/kanban-lite/issues/1))

## [0.1.1] - 2026-01-28

### Added
- AI agent integration for starting feature creation with Claude, Codex, or OpenCode
- Keyboard shortcuts for AI actions
- Configurable kanban columns with custom colors
- Priority badges, assignee, and due date display options
- Compact mode setting for feature cards
- Marketplace publishing support (VS Code + Open VSX)

### Changed
- Updated repository URLs to reflect new ownership
- Replaced SVG icons with PNG formats for better compatibility
- Enhanced README with installation instructions and images

## [0.1.0] - 2026-01-27

### Added
- Initial release
- Kanban board view for managing features as markdown files
- Drag-and-drop between columns (Backlog, To Do, In Progress, Review, Done)
- Feature cards with frontmatter metadata (status, priority, assignee, due date)
- Create, edit, and delete features from the board
- Configurable features directory
- Rich markdown editor with Tiptap
- VS Code webview integration
