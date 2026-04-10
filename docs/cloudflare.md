# Cloudflare Workers

This document explains the current Kanban Lite Cloudflare Workers path, what the Worker runtime does, how plugin loading works there, what is still unsupported, and how to deploy it.

It is intentionally explicit about the limits: the current Worker entrypoint is a **Worker-safe standalone host with event-driven live refresh**, not a byte-for-byte clone of the Node standalone server. It still does **not** provide full Node standalone parity.

---

## What ships today

The repository now includes:

- a Worker-friendly fetch + queue entrypoint at `packages/kanban-lite/src/worker/index.ts`
- runtime-host hooks that let non-Node hosts inject:
  - config reads/writes
  - workspace env loading
  - external module resolution
- a reusable standalone dispatcher at `packages/kanban-lite/src/standalone/dispatch.ts`
- Wrangler config at `packages/kanban-lite/wrangler.toml`
- a deployment helper script at `scripts/deploy-cloudflare-worker.mjs`
- a generated Durable Object seam that now handles both active-card persistence and Cloudflare live-sync invalidations

The goal is:

1. keep the existing Node standalone server as the default host
2. reuse the same SDK + standalone HTTP handlers on Cloudflare
3. statically bundle Worker-safe plugins instead of relying on Node runtime package discovery

---

## How it works on Cloudflare

### 1. The Worker installs a runtime host

The Node runtime normally reads `.kanban.json`, `.env`, and plugin packages directly from disk / `node_modules`.

Cloudflare Workers cannot rely on that model, so the Worker entrypoint installs a runtime host before it creates the SDK:

- `readConfig(...)` can return an in-memory config object
- `writeConfig(...)` can be overridden by a custom host if you have a writable backing store
- `loadWorkspaceEnv(...)` can be overridden so config placeholders do not depend on local `.env` files
- `resolveExternalModule(...)` can return statically bundled plugin modules

That means the same SDK and standalone HTTP route layer can run without using the Node filesystem/module loader path by default.

### 2. `fetch` and `queue` share one bootstrap + module-registry contract

The Worker entrypoint now treats HTTP requests and callback queue deliveries as two faces of the same host contract:

- both entrypoints resolve the same embedded bootstrap envelope
- both entrypoints use the same `KANBAN_MODULES` registry for Worker-safe static imports
- both entrypoints enforce the same fail-closed callback module validation before work begins

For durable callback delivery, the queue-side ABI is intentionally compact and zero-idle:

- logical queue handle: `callbacks`
- consumer export: `queue`
- payload shape: `{ version, kind, eventId }`

The queue payload carries only a durable callback event reference, not the full event blob. The Worker persists one D1 event snapshot per committed callback event, then replays matched module handlers sequentially from that durable record while checkpointing after every handler attempt. Retries skip already-completed handlers, keep canonical handler-level idempotency claims, and preserve the same Worker budget goal: no polling, no cron, and no extra steady-state request-path D1 reads. The durable-record write model is one claim/upsert plus one checkpoint per handler attempt, with the terminal summary folded into the final checkpoint rather than a fixed two-write cap, for a total lifecycle budget of `1 + total handler attempts`.

### 3. The Worker reuses the standalone HTTP dispatcher

The Worker does not reimplement the REST API.

Instead it reuses the same standalone middleware + route pipeline through:

- `createStandaloneRouteDispatcher(...)`

So the Worker path still uses the existing standalone handlers for:

- system routes
- board routes
- task routes
- mobile routes
- standalone HTTP plugin routes/middleware

### 4. Static assets come from the Wrangler `ASSETS` binding

The standalone webview build still lives in:

- `packages/kanban-lite/dist/standalone-webview`

Wrangler serves those files through the `ASSETS` binding declared in `packages/kanban-lite/wrangler.toml`.

### 5. Plugins are bundled, not discovered dynamically

On Node, Kanban Lite can discover plugins through installed packages, workspace packages, global npm installs, and a sibling-package fallback.

On Cloudflare, the recommended path is different:

- import the plugin modules at build/deploy time
- register them in the Worker `moduleRegistry`
- let `resolveExternalModule(...)` return those already-bundled modules

That is what the deployment script scaffolds for you.

---

## Current support level

### Supported in this patch

- standalone HTTP API hosting through the existing dispatcher
- standalone static asset hosting through Wrangler assets
- Durable Object-backed `/ws` upgrades for Worker live-sync invalidations
- event-driven latest-state resync over `/api/webview-sync` after committed mutations
- statically bundled plugin module injection
- custom config injection
- explicit deployment workflow for a Worker wrapper

### Explicitly not supported yet

- full WebSocket payload parity with the Node standalone server
- exact ordered replay of every missed event after disconnect
- file watching / `chokidar`
- local temp-file editing flows that assume writable disk
- runtime `npm install` from inside the app
- Node-only plugin implementations that require:
  - `fs`
  - native drivers
  - raw TCP sockets
  - `child_process`

---

## WebSockets on Cloudflare

The Worker entrypoint now accepts `/ws` upgrades when the generated `KANBAN_ACTIVE_CARD_STATE` Durable Object binding is present.

That WebSocket is intentionally **not** a clone of the Node standalone WebSocket server.

The Node standalone runtime currently depends on:

- a single in-process WebSocket server
- per-client auth-scoped `init` / `cardsUpdated` decoration
- shared in-memory client tracking
- direct fan-out from mutation flows

Cloudflare can support WebSockets, but matching the current semantics safely would require more than a simple upgrade handler. In particular:

1. **Durable Objects are the right coordination point** for connection state and fan-out.
2. **Auth-scoped payload decoration must remain per client**. Shared raw broadcasts must not leak actor-scoped card state.
3. **External mutation visibility changes** currently rely on Node watcher assumptions that do not exist in Workers.

So the Worker runtime uses a cheaper hybrid transport instead:

1. the browser opens `/ws`
2. the Durable Object replies with `{ type: "syncTransportMode", mode: "http-sync-websocket-notify" }`
3. the browser keeps sending authoritative board/card messages through `/api/webview-sync`
4. after committed non-auth SDK mutations, the Worker posts `{ type: "syncRequired", reason }` to the same Durable Object
5. connected tabs resync the latest board/card state over HTTP

What that gives you:

- event-driven cross-tab refresh without polling or long-polling
- latest-state catch-up after reconnects and invalidations
- the same Durable Object seam also backing active-card persistence for `/api/tasks/active`

What it still does **not** give you:

- exact ordered replay of every missed event
- raw Node-style WebSocket payload fan-out for every mutation
- watcher-driven visibility for external file changes

---

## Plugin compatibility on Cloudflare

The runtime-host + module-registry seam lets you **connect** plugin packages in Worker mode, but each plugin still has to be Worker-safe.

### Good fit

Packages that are mostly pure SDK / HTTP / schema logic are the best fit for static bundling.

### Needs review

Packages that depend on Node-only APIs may bundle successfully but still fail at runtime.

### Not a good fit in the current patch

- storage providers that depend on filesystem or native drivers
- callback handlers that expect subprocess execution
- anything that expects runtime npm installation/discovery

If you want production Worker deployments, prefer providers that talk to Worker-safe remote services or expose Worker-safe HTTP/storage contracts.

---

## Deployment script

Use the helper script from the repo root:

```bash
node scripts/deploy-cloudflare-worker.mjs --help
```

### What the script does

The script:

1. reads a `.kanban.json` file at deploy time
2. generates a temporary Worker wrapper entrypoint plus a Durable Object class for active-card persistence and live-sync invalidations
3. statically imports provider packages implied by the embedded config (including the default `webhook.delivery` provider `webhooks` → `kl-plugin-webhook` unless it is explicitly disabled), plus any requested `--plugin` packages and any configured `callback.runtime` module handlers when `plugins["callback.runtime"].provider === "cloudflare"`
4. builds the standalone web assets (unless `--skip-build` is used)
5. calls `wrangler deploy` with a generated config

### Why a generated wrapper is used

Cloudflare Workers do not support the Node plugin discovery path used by the Node standalone server. The generated wrapper solves that by embedding:

- the deploy-time config JSON
- any bootstrap-owned `config.storage` binding-handle and revision-source inputs passed to the helper
- the selected plugin imports and any configured callback module handler imports
- a prebuilt `moduleRegistry`

Before deployment continues, the helper also validates that configured callback modules resolve cleanly and that each named handler export exists. If a module cannot be resolved or a named export is missing, deployment fails closed before the Worker is published.

When `--create-resources` is enabled, the helper now reuses already-existing R2 buckets instead of surfacing Wrangler's “bucket already exists” API error on every deploy.

If `callback.runtime` stays on the Node `callbacks` provider instead, the generated Worker remains fetch-only: it embeds the config snapshot but does not emit callback module imports or a queue consumer. When the provider is `cloudflare`, the generated Worker bundles only module handlers, rejects enabled `inline` / `process` rows, and delivers one compact queue message per committed event rather than one message per matched handler.

Callback-enabled Cloudflare deploys also emit `compatibility_flags = ["nodejs_compat"]` alongside the configured compatibility date so Worker-safe SDK/plugin imports keep the required Node compatibility shims available at runtime.

---

## Deployment examples

### Minimal deploy

```bash
node scripts/deploy-cloudflare-worker.mjs \
  --name kanban-lite-worker \
  --config /absolute/path/to/.kanban.json
```

### Deploy with bundled standalone plugins

```bash
node scripts/deploy-cloudflare-worker.mjs \
  --name kanban-lite-worker \
  --config /absolute/path/to/.kanban.json \
  --plugin kl-plugin-auth \
  --plugin kl-plugin-webhook \
  --plugin kl-plugin-callback
```

If your Cloudflare config leaves `plugins["webhook.delivery"]` unset, the deploy helper still bundles `kl-plugin-webhook` automatically because runtime normalization defaults that capability to `webhooks`. Only an explicit `provider: "none"` disables webhook delivery for the Worker bundle.

### Deploy with callback.runtime provider `cloudflare`

If `plugins["callback.runtime"].provider` is `cloudflare` and any enabled `type: "module"` handlers are configured, `--callback-queue <name>` is required so the helper can emit an explicit Cloudflare Queue consumer. The related queue tuning flags stay optional but should be set deliberately for production rollouts.

```bash
node scripts/deploy-cloudflare-worker.mjs \
  --name kanban-lite-worker \
  --config /absolute/path/to/.kanban.json \
  --plugin kl-plugin-auth \
  --plugin kl-plugin-cloudflare \
  --callback-queue kanban-callbacks \
  --callback-max-batch-size 1 \
  --callback-max-batch-timeout 0 \
  --callback-max-retries 3 \
  --callback-dead-letter-queue kanban-callbacks-dlq
```

### Dry run

```bash
node scripts/deploy-cloudflare-worker.mjs \
  --name kanban-lite-worker \
  --config /absolute/path/to/.kanban.json \
  --plugin kl-plugin-auth \
  --dry-run
```

---

## Script flags

- `--name <worker-name>`: Worker name passed to Wrangler
- `--config <path>`: absolute or relative path to the `.kanban.json` file to embed
- `--plugin <package>`: plugin package to statically bundle; may be repeated
- `--kanban-dir <path>`: logical kanban directory passed to the Worker runtime (default: `.kanban`)
- `--config-storage-binding <logical=binding>`: repeatable bootstrap-owned Worker binding handle mapping (for example `database=KANBAN_DB` or `callbacks=KANBAN_QUEUE`)
- `--config-revision-binding <binding>`: Worker binding that exposes the current config revision for bootstrap-owned refresh checks
- `--callback-queue <name>`: required when `plugins["callback.runtime"].provider === "cloudflare"` and any enabled `type: "module"` handlers exist; names the Cloudflare Queue consumer the helper emits into the generated Wrangler config
- `--callback-max-batch-size <n>`: optional Queue consumer `max_batch_size` override for callback-enabled Cloudflare deploys (default: `1`)
- `--callback-max-batch-timeout <n>`: optional Queue consumer `max_batch_timeout` override in seconds for callback-enabled Cloudflare deploys (default: `0`)
- `--callback-max-retries <n>`: optional Queue consumer `max_retries` override for callback-enabled Cloudflare deploys (default: `3`)
- `--callback-dead-letter-queue <name>`: optional dead-letter queue name emitted as `dead_letter_queue` for callback-enabled Cloudflare deploys
- `--compatibility-date <yyyy-mm-dd>`: Wrangler compatibility date override
- `--skip-build`: skip `pnpm run build:worker`
- `--dry-run`: generate the wrapper/config and print the Wrangler command without deploying

---

## Wrangler config

The committed baseline config is:

```toml
name = "kanban-lite-worker"
main = "src/worker/index.ts"
compatibility_date = "2026-04-05"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "dist/standalone-webview"
binding = "ASSETS"
```

The deployment helper generates a temporary deploy config so it can point Wrangler at the generated wrapper entrypoint while still reusing the same assets directory. Generated configs also emit the same `nodejs_compat` flag and append `[[queues.consumers]]` when callback-enabled Cloudflare module handlers require queue delivery.

---

## Recommended deployment flow

1. Make sure the standalone webview builds locally:

   ```bash
   cd packages/kanban-lite
   pnpm run build:worker
   ```

2. Decide which plugins are actually Worker-safe for your deployment.

3. Run the deployment helper:

   ```bash
   cd /home/runner/work/kanban-lite/kanban-lite
   node scripts/deploy-cloudflare-worker.mjs \
     --name kanban-lite-worker \
     --config .kanban.json \
     --plugin kl-plugin-auth \
     --plugin kl-plugin-webhook
   ```

If the workspace selects `plugins["callback.runtime"].provider = "cloudflare"`, add `--callback-queue <name>` and any queue tuning flags shown above before deploying.

After deploying, verify that:

- static board assets load
- REST API routes respond
- any bundled standalone plugin routes work
- opening two tabs shows committed mutations propagate via the Worker live-sync transport
- `/ws` no longer returns `501` when the generated Durable Object binding is present

---

## Operational caveats

### Config is embedded at deploy time by default

The helper script embeds the selected config into the generated Worker wrapper.

That means:

- changing `.kanban.json` locally does **not** update the deployed Worker until you redeploy
- if you need runtime mutability, provide a custom `writeConfig(...)` / `readConfig(...)` runtime host backed by a Worker-safe store

### The default markdown/localfs model is not Worker-native

The default Kanban Lite storage path assumes local files under `.kanban/`.

That is a strong fit for Node, but not for Cloudflare Workers. The Worker host path is primarily an integration seam:

- the HTTP/API layer can run
- plugin loading can be injected
- production storage still needs a Worker-safe backend strategy

### Page/UI parity depends on assets, not Node server semantics

The Worker host serves built standalone assets, but it does not replicate every Node-only behavior behind the scenes. Treat it as a separate host surface with explicit guardrails, not as a byte-for-byte clone of the Node process model.

---

## Summary

Cloudflare support currently means:

- reuse the Kanban Lite SDK and standalone HTTP pipeline
- inject config and plugin modules through the runtime-host seam
- use the first-party `cloudflare` storage bundle for `card.storage`, `attachment.storage`, `card.state`, and `config.storage` with D1 + R2 through the shared Worker binding/context contract
- deploy a generated Worker wrapper with Wrangler
- serve standalone assets through the `ASSETS` binding
- use a Durable Object-backed WebSocket invalidation channel plus HTTP latest-state resync for event-driven cross-tab refreshes
- accept that full raw Node WebSocket parity still remains out of scope for the Worker host

If you need full standalone parity on Cloudflare, the next major step would be richer Durable Object coordination for raw payload fan-out and replay semantics; the current Worker-safe path already ships the cheaper latest-state invalidation model together with the canonical `cloudflare` storage/provider bundle.
