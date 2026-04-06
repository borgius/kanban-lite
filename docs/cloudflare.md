# Cloudflare Workers

This document explains the current Kanban Lite Cloudflare Workers path, what the Worker runtime does, how plugin loading works there, what is still unsupported, and how to deploy it.

It is intentionally explicit about the limits: the current Worker entrypoint is a **minimal HTTP host** for the standalone runtime. It does **not** yet provide full Node standalone parity.

---

## What ships today

The repository now includes:

- a Worker-friendly fetch entrypoint at `packages/kanban-lite/src/worker/index.ts`
- runtime-host hooks that let non-Node hosts inject:
  - config reads/writes
  - workspace env loading
  - external module resolution
- a reusable standalone dispatcher at `packages/kanban-lite/src/standalone/dispatch.ts`
- Wrangler config at `packages/kanban-lite/wrangler.toml`
- a deployment helper script at `scripts/deploy-cloudflare-worker.mjs`

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

### 2. The Worker reuses the standalone HTTP dispatcher

The Worker does not reimplement the REST API.

Instead it reuses the same standalone middleware + route pipeline through:

- `createStandaloneRouteDispatcher(...)`

So the Worker path still uses the existing standalone handlers for:

- system routes
- board routes
- task routes
- mobile routes
- standalone HTTP plugin routes/middleware

### 3. Static assets come from the Wrangler `ASSETS` binding

The standalone webview build still lives in:

- `packages/kanban-lite/dist/standalone-webview`

Wrangler serves those files through the `ASSETS` binding declared in `packages/kanban-lite/wrangler.toml`.

### 4. Plugins are bundled, not discovered dynamically

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
- statically bundled plugin module injection
- custom config injection
- explicit deployment workflow for a Worker wrapper

### Explicitly not supported yet

- WebSocket parity with the Node standalone server
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

The current Worker entrypoint returns `501` for WebSocket upgrade requests.

That is intentional.

The Node standalone runtime currently depends on:

- a single in-process WebSocket server
- per-client auth-scoped `init` / `cardsUpdated` decoration
- shared in-memory client tracking
- direct fan-out from mutation flows

Cloudflare can support WebSockets, but matching the current semantics safely would require more than a simple upgrade handler. In particular:

1. **Durable Objects are the right coordination point** for connection state and fan-out.
2. **Auth-scoped payload decoration must remain per client**. Shared raw broadcasts must not leak actor-scoped card state.
3. **External mutation visibility changes** currently rely on Node watcher assumptions that do not exist in Workers.

So the current Worker runtime is honest about the gap:

- REST works
- static assets work
- realtime `/ws` parity does not ship yet

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
2. generates a temporary Worker wrapper entrypoint
3. statically imports the requested plugin packages
4. builds the standalone web assets (unless `--skip-build` is used)
5. calls `wrangler deploy` with a generated config

### Why a generated wrapper is used

Cloudflare Workers do not support the Node plugin discovery path used by the Node standalone server. The generated wrapper solves that by embedding:

- the deploy-time config JSON
- the selected plugin imports
- a prebuilt `moduleRegistry`

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

[assets]
directory = "dist/standalone-webview"
binding = "ASSETS"
```

The deployment helper generates a temporary deploy config so it can point Wrangler at the generated wrapper entrypoint while still reusing the same assets directory.

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

4. Verify:
   - static board assets load
   - REST API routes respond
   - any bundled standalone plugin routes work
   - `/ws` returns the documented unsupported response

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
- deploy a generated Worker wrapper with Wrangler
- serve standalone assets through the `ASSETS` binding
- accept that realtime WebSocket parity still needs a Durable Object follow-up

If you need full standalone parity on Cloudflare, the next major step is a Durable Object-backed realtime layer plus Worker-safe storage/provider implementations.
