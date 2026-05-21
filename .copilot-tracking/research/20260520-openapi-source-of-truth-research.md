<!-- markdownlint-disable-file -->

# Task Research Notes: OpenAPI Source of Truth and TSOA Fit for Standalone HTTP Contracts

## Research Executed

### File Analysis

- `packages/kanban-lite/src/standalone/server.ts`
  - The standalone server is a `Hono` app that serves `/api/docs` and `/api/docs/json`, then forwards all other requests into `createStandaloneRouteDispatcher()` using raw Node `IncomingMessage` / `ServerResponse` objects.
- `packages/kanban-lite/src/standalone/dispatch.ts`
  - Runtime dispatch is request-context based: plugin middleware runs first, then plugin routes, then built-in route handlers created from a shared contract layer, then the standalone SPA fallback.
- `packages/kanban-lite/src/standalone/internal/http-contracts.ts`
  - The repo already has a built-in standalone route-contract registry. `BUILTIN_STANDALONE_ROUTE_CONTRACTS` binds method, runtime path, OpenAPI path, and operation metadata to the existing handlers; `buildBuiltInStandaloneOpenApiPaths()` generates the built-in `paths` map from that registry.
- `packages/kanban-lite/src/standalone/internal/http-contracts.test.ts`
  - Parity tests assert that the built-in contract registry and `KANBAN_OPENAPI_SPEC.paths` stay aligned, including `GET /api/health`, `POST /api/webview-sync`, and `POST /api/tasks/{id}/comments/stream`.
- `packages/kanban-lite/src/standalone/internal/openapi-spec/spec.ts`
  - `KANBAN_OPENAPI_SPEC` owns base metadata (`info`, `tags`, `components`) while its `paths` now come from `buildBuiltInStandaloneOpenApiPaths()` rather than an independent hand-maintained list.
- `packages/kanban-lite/src/standalone/internal/openapi-spec/build.ts`
  - `buildStandaloneOpenApiSpec()` merges built-in paths with plugin-owned `getOpenApiDocs()` fragments. Core keeps only a webhook fallback fragment for backward compatibility when the plugin does not publish docs.
- `packages/kanban-lite/src/sdk/plugins/mcp-sdk-plugins.ts`
  - `StandaloneHttpPlugin` exposes `registerMiddleware()`, `registerRoutes()`, and `getOpenApiDocs()` for plugin-owned standalone HTTP surfaces. There is no controller/decorator abstraction here.
- `packages/kl-plugin-auth/src/auth-http.ts`
  - Local auth contributes request middleware plus route handlers and OpenAPI docs for `POST/GET/DELETE /api/mobile/session`. The implementation is request-context and file-backed session based, not controller/decorator based.
- `packages/kl-plugin-webhook/src/plugins.ts`
  - The webhook plugin owns runtime routes and OpenAPI docs for `/api/webhooks`, `/api/webhooks/{id}`, and `/api/webhooks/test` from the same package.
- `packages/kanban-lite/src/standalone/internal/routes/mobile-docs.ts`
  - Mobile bootstrap and session docs are plain OpenAPI fragment objects, not derived from a controller layer.
- `packages/kanban-lite/src/standalone/internal/routes/system.ts`
  - Built-in system endpoints include `/api/health` and `/api/webview-sync`; both are routed through the same raw-dispatch request context used by the rest of the standalone server.
- `packages/kanban-lite/src/standalone/internal/routes/tasks/content-routes.ts`
  - `POST /api/tasks/:id/comments/stream` reads a plain-text streaming request body and emits chunked WebSocket updates while the SDK persists the streamed comment.
- `packages/kanban-lite/src/worker/worker-entry.ts`
  - The Cloudflare Worker runtime also reuses `createStandaloneRouteDispatcher()` and `buildStandaloneOpenApiSpec()`, so the standalone OpenAPI contract is shared across Node and Worker transports.
- `scripts/generate-api-docs.ts`
  - `docs/api.md` is generated from `buildStandaloneOpenApiSpec()` plus active standalone plugin OpenAPI fragments.
- `scripts/generate-openapi-types.ts`
  - The repo already generates TypeScript path types from the standalone OpenAPI spec into `packages/kanban-lite/src/sdk/remote/generated/standalone-api-paths.ts`.
- `packages/kanban-lite/src/sdk/remote/openapi-client.ts`
  - The repo exports a typed standalone fetch helper built on the generated OpenAPI `paths` types (`StandaloneApiPath`, `StandaloneApiRequestBody`, `StandaloneApiResponse`).
- `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts`
  - `RemoteKanbanSDK` now wraps the generated standalone client instead of owning a completely separate handwritten HTTP contract.
- `packages/mobile/src/lib/api/client.ts`
  - The mobile client depends on `StandaloneApiPath` and `StandaloneApiRequestBody` types from `kanban-lite/sdk`, so the current OpenAPI pipeline already drives mobile request typing.
- `packages/kl-adapter-vercel-ai/src/client.ts`
  - The packaged Vercel AI adapter client also depends on `StandaloneApiPath` plus `createStandaloneApiClient()` from the SDK.
- `packages/n8n-nodes-kanban-lite/src/transport/normalize.ts`
  - n8n still keeps an operation-to-route mapping table, but URL construction now goes through `buildStandaloneApiUrl()` and typed standalone paths rather than raw string concatenation everywhere.
- `.copilot-tracking/plans/20260520-openapi-source-of-truth-plan.instructions.md`
  - The generic plan still describes a future route-contract registry and plugin-doc seam as pending work, but the codebase now implements those pieces.
- `.copilot-tracking/details/20260520-openapi-source-of-truth-details.md`
  - The details file is similarly pre-implementation for Phases 1–3 and does not consider TSOA specifically.
- `.copilot-tracking/changes/20260520-openapi-source-of-truth-changes.md`
  - The changes tracker says the contract registry, plugin-owned docs, generated remote client, and downstream client adoption were completed, which matches the current source tree more closely than the older research text.
- `.copilot-tracking/research/20260520-openapi-source-of-truth-research.md`
  - The previous version of this research note was stale for the TSOA question: it still claimed there was no shared route-contract object and that several now-documented routes were missing from the spec.
- `package.json`
  - Root scripts already include `contracts:openapi`, `docs:root:api`, and `docs:root`, showing an existing OpenAPI generation workflow.
- `packages/kanban-lite/package.json`
  - The package already builds the SDK after `contracts:openapi`; the standalone implementation depends on the generated OpenAPI types and does not currently include `tsoa`, `@tsoa/runtime`, or controller-generation scripts.
- `tsconfig.base.json`
  - The repo uses `moduleResolution: "bundler"` and `isolatedModules: true`; there are no decorator-related compiler flags enabled.
- `packages/kanban-lite/tsconfig.json`
  - The standalone/server package inherits the base config and likewise has no `experimentalDecorators` or `emitDecoratorMetadata` enabled.

### Code Search Results

- `createStandaloneRouteDispatcher|createBuiltInStandaloneRouteHandlers|buildBuiltInStandaloneOpenApiPaths`
  - Located the current ownership seam in `packages/kanban-lite/src/standalone/dispatch.ts` and `packages/kanban-lite/src/standalone/internal/http-contracts.ts`; runtime binding and built-in OpenAPI paths already come from one contract registry.
- `getOpenApiDocs|registerRoutes|registerMiddleware`
  - Located plugin-owned standalone HTTP docs/runtime seams in `packages/kl-plugin-auth/src/auth-http.ts`, `packages/kl-plugin-webhook/src/plugins.ts`, and `packages/kanban-lite/src/sdk/plugins/mcp-sdk-plugins.ts`.
- `StandaloneApiPath|StandaloneApiRequestBody|createStandaloneApiClient`
  - Located generated-contract consumption in `packages/kanban-lite/src/sdk/remote/openapi-client.ts`, `packages/kanban-lite/src/sdk/remote/RemoteKanbanSDK.ts`, `packages/mobile/src/lib/api/client.ts`, `packages/kl-adapter-vercel-ai/src/client.ts`, and `packages/n8n-nodes-kanban-lite/src/transport/normalize.ts`.
- `experimentalDecorators|emitDecoratorMetadata`
  - No matches in repo `tsconfig*.json` files. The current build is not configured for TSOA-style decorator metadata or TSOA custom-middleware requirements.
- `tsoa|@Route\(|@Get\(|@Post\(`
  - No matches in `packages/**`, confirming the repo has no existing TSOA/controller annotation layer.
- `comments/stream|/api/mobile/session|/api/webhooks/test|/api/webview-sync|/api/health`
  - Found these routes in the runtime handlers, the generated standalone OpenAPI types, docs-site output, and integration/parity tests. They are current public-contract surfaces, not undocumented edge cases.

### External Research

- #fetch:https://tsoa-community.github.io/docs/introduction.html
  - TSOA’s core model is “TypeScript controllers and models as the single source of truth.” It generates OpenAPI and routes for Express, Koa, and Hapi, with runtime validation attached to the generated routes.
- #fetch:https://tsoa-community.github.io/docs/routes.html
  - Route generation depends on controller discovery and a `RegisterRoutes(app)` style mounting flow in an application entry file.
- #fetch:https://tsoa-community.github.io/docs/templates.html
  - Unsupported runtimes can use a custom Handlebars route template, but the docs explicitly warn that custom templates are powerful yet costly and harder to migrate across TSOA versions.
- #fetch:https://tsoa-community.github.io/docs/authentication.html
  - Authentication is driven by `@Security(...)` decorators plus a framework-specific authentication module configured in `tsoa.json`.
- #fetch:https://tsoa-community.github.io/docs/custom-middlewares.html
  - Custom middleware support is documented for Express, Koa, and Hapi middlewares, and the docs call out `experimentalDecorators` plus `emitDecoratorMetadata` as required compiler flags.
- #fetch:https://tsoa-community.github.io/docs/file-upload.html
  - File upload support centers on `@UploadedFile(s)` or custom multer handling and can require explicit OpenAPI merge overrides.
- #fetch:https://tsoa-community.github.io/docs/generating.html
  - TSOA requires separate spec/routes generation (`tsoa spec`, `tsoa routes`) or equivalent programmatic config with `entryFile`, controller globs, base path, and routes output directory.
- #fetch:https://github.com/lukeautry/tsoa
  - The README reiterates controllers/models as the source of truth and route generation for Express, Hapi, Koa, or a custom template.

### Project Conventions

- Standards referenced: `AGENTS.md`; `.github/instructions/core-surface.instructions.md`.
- Instructions followed: preserve SDK-first sequencing; keep API/CLI/MCP parity anchored in the SDK; treat `docs/api.md` as generated output; update only `.copilot-tracking/research/` during this research task.

## Key Discoveries

### Project Structure

The repo’s current standalone HTTP contract is already moving in the direction the earlier generic research recommended, and that matters a lot for the TSOA decision.

Built-in standalone routes are no longer “manual runtime plus separate docs” in the old sense. `packages/kanban-lite/src/standalone/internal/http-contracts.ts` now provides a shared contract registry where each public built-in route binds:

- HTTP method
- runtime path
- OpenAPI path
- OpenAPI method
- OpenAPI operation metadata
- the existing handler function

`packages/kanban-lite/src/standalone/internal/openapi-spec/spec.ts` generates `paths` from that contract registry, and `packages/kanban-lite/src/standalone/internal/http-contracts.test.ts` enforces parity.

Plugin-owned routes have their own contract/docs seam. `StandaloneHttpPlugin` in `packages/kanban-lite/src/sdk/plugins/mcp-sdk-plugins.ts` exposes `registerMiddleware()`, `registerRoutes()`, and `getOpenApiDocs()`. The auth plugin and webhook plugin both use that seam today. That means the standalone HTTP surface is not just “one app with one static route list”; part of the public API is capability/plugin owned.

The current OpenAPI document is also reused in more places than just docs:

- standalone Node server docs routes in `packages/kanban-lite/src/standalone/server.ts`
- Cloudflare Worker docs routes in `packages/kanban-lite/src/worker/worker-entry.ts`
- markdown docs generation in `scripts/generate-api-docs.ts`
- OpenAPI TypeScript generation in `scripts/generate-openapi-types.ts`
- typed remote helpers in `packages/kanban-lite/src/sdk/remote/openapi-client.ts`
- downstream request typing in the mobile client, Vercel AI adapter, and n8n transport

This repo therefore does **not** have a missing contract system that TSOA would neatly fill. It already has a contract system, and it is tailored to the repo’s SDK-first, plugin-extensible standalone architecture.

### Implementation Patterns

The current pattern is:

1. `KanbanSDK` owns business behavior.
2. The standalone layer owns transport behavior through raw request-context handlers.
3. Built-in public routes are described by a route-contract registry.
4. Plugin-owned public routes contribute their own runtime handlers and OpenAPI fragments.
5. OpenAPI is turned into generated TypeScript path types for remote callers.

That pattern is materially different from TSOA’s model.

TSOA expects a controller-annotation source of truth discovered statically at build time. Generated routes are then mounted into an Express/Koa/Hapi application or into a custom-template equivalent. Auth is expressed through decorators and a TSOA auth module. Middleware is framework middleware. Uploads are modeled through decorator/multer patterns. The request/response runtime is generated from controller metadata.

By contrast, `kanban-light` uses:

- a `Hono` shell only for top-level docs and catch-all registration
- raw Node request/response dispatch in `createStandaloneRouteDispatcher()`
- plugin-discovered middleware and routes at runtime
- shared Node + Worker contract generation
- request-context auth merging rather than decorator-scoped auth modules
- specialized non-controller endpoints such as:
  - `POST /api/tasks/:id/comments/stream` with plain-text streaming body and live chunk broadcasts
  - `GET /api/tasks/:id/attachments/:filename` returning binary content
  - `POST /api/webview-sync` as a transport sync endpoint for the standalone webview shell
  - `POST/GET/DELETE /api/mobile/session` as a plugin-owned bearer-session/auth surface

TSOA can model some of these features individually, but only by forcing the repo into a controller-centric source-of-truth that does not match its current dispatcher and plugin model.

The biggest repo-specific mismatch is plugin ownership. TSOA controller discovery is static (`controllerPathGlobs` or explicit imports). `kanban-light` discovers active standalone HTTP plugins from the resolved capability bag, then loads `registerMiddleware()`, `registerRoutes()`, and `getOpenApiDocs()` from those active packages. Replacing that with TSOA would either:

- require a second plugin-to-controller discovery layer at build time, or
- leave plugin routes outside TSOA and split the HTTP contract into two incompatible sources of truth

Either outcome is worse than the current architecture.

### Complete Examples

```ts
// Source: packages/kanban-lite/src/standalone/server.ts
const standaloneOpenApiSpec = buildStandaloneOpenApiSpec(
  collectStandalonePluginOpenApiDocs(
    standaloneHttpPlugins,
    createStandaloneHttpPluginRegistrationOptions(ctx),
  ),
)

app.get(docsJsonPath, (c) => c.json(standaloneOpenApiSpec as unknown as Record<string, unknown>))

const dispatcher = createStandaloneRouteDispatcher(ctx, resolvedWebviewDir, resolvedIndexHtml, basePath)
app.all('*', async (c) => {
  const req = c.env.incoming as IncomingMessageWithRawBody
  const res = c.env.outgoing
  await dispatcher.handle(req, res)
  c.header('x-hono-already-sent', '1')
  return c.body(null)
})

// Source: packages/kanban-lite/src/standalone/internal/http-contracts.ts
export const BUILTIN_STANDALONE_ROUTE_CONTRACTS = [
  createPublicRouteContract('POST', '/api/tasks/{id}/comments/stream', handleTaskContentRoutes),
  createPublicRouteContract('GET', '/api/health', handleSystemApiRoutes),
  createPublicRouteContract('POST', '/api/webview-sync', handleSystemApiRoutes),
] as const

// Source: packages/kanban-lite/src/sdk/plugins/mcp-sdk-plugins.ts
export interface StandaloneHttpPlugin {
  registerMiddleware?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[]
  registerRoutes?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneHttpHandler[]
  getOpenApiDocs?(options: StandaloneHttpPluginRegistrationOptions): readonly StandaloneOpenApiDocFragment[]
}
```

### API and Schema Documentation

The current standalone contract chain is:

- `packages/kanban-lite/src/standalone/internal/http-contracts.ts`
  - built-in public route registry
- `packages/kanban-lite/src/standalone/internal/openapi-spec/spec.ts`
  - base standalone OpenAPI metadata plus generated built-in `paths`
- `packages/kanban-lite/src/standalone/internal/openapi-spec/build.ts`
  - merges plugin `getOpenApiDocs()` fragments into the final spec
- `packages/kanban-lite/src/standalone/server.ts`
  - serves `/api/docs/json` and `/api/docs`
- `packages/kanban-lite/src/worker/worker-entry.ts`
  - serves the same standalone OpenAPI contract in the Worker runtime
- `scripts/generate-api-docs.ts`
  - generates `docs/api.md`
- `scripts/generate-openapi-types.ts`
  - generates `packages/kanban-lite/src/sdk/remote/generated/standalone-api-paths.ts`
- `packages/kanban-lite/src/sdk/remote/openapi-client.ts`
  - exports typed standalone request helpers consumed by remote clients

TSOA would introduce a different contract chain centered on `tsoa.json`, controller discovery, generated `routes.ts`, generated OpenAPI output, optional auth module wiring, and optionally a custom route template. That would not drop into the current pipeline; it would replace large portions of it.

The required TSOA-specific moving parts, based on the official docs, would include:

- a `tsoa.json` or equivalent programmatic generator config
- controller discovery globs or explicit controller imports
- generated routes output
- a selected middleware target (`express`, `koa`, `hapi`) or a custom template
- a TSOA auth module for `@Security`
- possible spec merge overrides for certain upload shapes
- decorator-enabled TypeScript compilation for middleware-heavy use cases

### Configuration Examples

```json
{
  "currentRepo": {
    "scripts": {
      "contracts:openapi": "npx tsx scripts/generate-openapi-types.ts",
      "docs:root:api": "npx tsx scripts/generate-api-docs.ts"
    },
    "tsconfig": {
      "moduleResolution": "bundler",
      "isolatedModules": true,
      "experimentalDecorators": false,
      "emitDecoratorMetadata": false
    }
  },
  "tsoaWouldNeed": {
    "entryFile": "src/standalone/server.ts",
    "controllerPathGlobs": ["src/**/*Controller.ts"],
    "spec": {
      "specVersion": 3,
      "outputDirectory": "build"
    },
    "routes": {
      "routesDir": "build",
      "middleware": "express|koa|hapi",
      "authenticationModule": "./authentication.ts",
      "middlewareTemplate": "./custom-hono-template.hbs"
    },
    "compilerOptions": {
      "experimentalDecorators": true,
      "emitDecoratorMetadata": true
    }
  }
}
```

### Technical Requirements

If the repo were to migrate the standalone API to TSOA annotations, the impacted surfaces would include at minimum:

- `packages/kanban-lite/src/standalone/server.ts`
- `packages/kanban-lite/src/standalone/dispatch.ts`
- `packages/kanban-lite/src/standalone/internal/http-contracts.ts`
- `packages/kanban-lite/src/standalone/internal/routes/**`
- `packages/kanban-lite/src/sdk/plugins/mcp-sdk-plugins.ts`
- `packages/kl-plugin-auth/src/auth-http.ts`
- `packages/kl-plugin-webhook/src/plugins.ts`
- `packages/kanban-lite/src/worker/worker-entry.ts`
- `scripts/generate-api-docs.ts`
- `scripts/generate-openapi-types.ts`
- `packages/kanban-lite/src/sdk/remote/openapi-client.ts`
- downstream HTTP consumers in `packages/mobile`, `packages/kl-adapter-vercel-ai`, and `packages/n8n-nodes-kanban-lite`
- root/package TypeScript config and build scripts
- parity/integration tests around standalone docs, mobile session docs, worker docs, and plugin docs

Repo-specific blockers and risks are:

- **Dispatcher architecture mismatch**
  - Current runtime uses Hono only as a shell and raw Node request/response dispatch underneath. TSOA does not support Hono directly; using it here would require either a framework swap or a maintained custom route template.
- **Plugin route ownership**
  - Active standalone HTTP routes are capability/plugin discovered at runtime. TSOA controller discovery is static. Bridging those models would add a second discovery system or split ownership.
- **Auth and middleware integration**
  - Current auth relies on plugin middleware mutating request auth context and gating both API routes and page routes. TSOA auth is decorator plus auth-module based and assumes Express/Koa/Hapi request objects.
- **Validation semantics**
  - Current validation is a mix of request parsing, explicit checks, and SDK behavior. TSOA would generate validation from controller types, introducing another runtime validation layer that would need parity testing against the existing handlers and SDK rules.
- **Non-standard endpoints**
  - Streaming comments, binary attachment downloads, mobile session restore/revoke, and webview-sync transport behavior are all possible to model manually, but they are not the ergonomic “happy path” TSOA is optimized for.
- **Worker reuse**
  - The same standalone OpenAPI build path is reused in the Cloudflare Worker runtime. A TSOA migration would need to preserve that cross-runtime contract generation rather than just improving the Node server.
- **Build and compiler churn**
  - The repo has no TSOA/decorator setup today. Introducing `tsoa`, `@tsoa/runtime`, controller generation, decorator flags, and likely a custom Hono template would be net new infrastructure.
- **Planning artifact drift**
  - The generic plan/details files are already behind the actual code because they still describe the route-contract registry and plugin-doc seam as future work. Adding a TSOA migration on top of that stale baseline would compound planning drift.

## Recommended Approach

Do **not** refactor the repo’s standalone OpenAPI approach to use TSOA annotations as the primary source of truth.

The recommended direction is to keep the current contract-driven standalone architecture:

1. `KanbanSDK` remains the source of truth for shared business behavior.
2. `internal/http-contracts.ts` remains the built-in HTTP contract registry.
3. `StandaloneHttpPlugin.getOpenApiDocs()` remains the plugin-owned contract seam.
4. `buildStandaloneOpenApiSpec()` remains the spec aggregation point for Node server, Worker, generated docs, and generated TypeScript path types.
5. `scripts/generate-openapi-types.ts` plus `openapi-client.ts` remain the remote-typing pipeline.

TSOA is only defensible here as a narrowly isolated experiment outside the current standalone core — for example, a disposable proof-of-concept to measure custom-template overhead. It is not a good fit for replacing the current standalone OpenAPI pipeline because it would duplicate or fight the repo’s:

- Hono/raw-dispatch transport model
- plugin-owned route discovery
- shared Node + Worker spec generation
- existing route-contract registry
- existing generated-client consumption pattern

This means the correct architectural answer for the standalone API is:

- **Reject TSOA as the primary migration target for the current standalone server.**
- **Keep improving the current contract registry and generated-client path instead.**

## Implementation Guidance

- **Objectives**: Keep OpenAPI authoritative for the standalone public HTTP contract and generated remote callers without replacing the SDK-first architecture or introducing a controller/decorator runtime that does not match the repo.
- **Key Tasks**: Refresh research and follow-on planning to reflect the current implemented route-contract/plugin-doc/generated-client architecture; add an explicit “TSOA not selected” decision record; remove stale references that describe the built-in contract registry as missing; keep future work focused on verification, residual consumer cleanup, and documentation clarity rather than on controller migration.
- **Dependencies**: Existing `internal/http-contracts.ts` registry; `StandaloneHttpPlugin.getOpenApiDocs()` plugin seam; `buildStandaloneOpenApiSpec()`; `scripts/generate-api-docs.ts`; `scripts/generate-openapi-types.ts`; downstream clients already consuming generated OpenAPI path types.
- **Success Criteria**: Research and future planning describe the current contract-driven architecture accurately; TSOA is explicitly ruled out as the standalone migration path; the repo continues to use one standalone OpenAPI build path across Node server docs, Worker docs, generated markdown docs, and generated remote client types.
