# Standalone compatibility matrix for T1

## External contracts to preserve

| Surface | Current contract | Known callers / coverage | Refactor guardrail |
|---|---|---|---|
| `startServer(kanbanDir, port, webviewDir?)` | Synchronous factory returning a raw `http.Server` that is already wired for HTTP routes, `/ws`, watcher lifecycle, and `close()` semantics | `src/standalone/index.ts`, `src/cli/index.ts`, `src/extension/index.ts` | Keep the exported signature and raw server return value unchanged through T2/T3 |
| WebSocket endpoint | Raw `ws` server mounted at `/ws`; auth comes from request headers; messages still flow through `handleMessage()` | `src/standalone/__tests__/server.integration.test.ts` | Preserve path, protocol, and per-message auth propagation |
| SPA/static behavior | `/` and unknown non-asset paths return HTML shell; static assets resolve from the standalone webview dir | `src/standalone/__tests__/server.integration.test.ts` | Preserve fallback ordering and content types |
| REST API surface | Existing `/api/**` routes, status codes, JSON envelope format, and legacy attachment endpoints remain unchanged | `src/standalone/__tests__/server.integration.test.ts`, `src/standalone/__tests__/webhooks.test.ts` | Reuse existing helper/services instead of rewriting business logic |
| Watcher + temp editor lifecycle | Chokidar watcher boots with the server, broadcasts reloads, temp editor files sync back for non-file-backed storage, and `close()` tears resources down | `src/standalone/__tests__/server.integration.test.ts` watcher tests | Keep watcher setup centralized and explicitly clean temp watcher/file state on close |

## Target module map for the pre-Fastify extraction

| Module | Ownership boundary | Notes |
|---|---|---|
| `src/standalone/internal/runtime.ts` | Build server runtime, websocket server, SDK, shared mutable context, and HTML shell | Keeps server bootstrap contract centralized |
| `src/standalone/internal/common.ts` | Shared request types, route matching adapter, card filter helpers, provider/static helpers | Reused by all route-domain modules |
| `src/standalone/internal/websocket.ts` | Raw websocket connection wiring and message dispatch to existing message handlers | No protocol changes |
| `src/standalone/internal/lifecycle.ts` | Watcher bootstrap, temp-file cleanup, and `/api/card-file` temp-editor lifecycle | Bridges existing `watcherSetup.ts` behavior into extracted lifecycle code |
| `src/standalone/internal/routes/boards.ts` | Boards, board actions, board-scoped tasks/columns/logs, board transfer endpoints | Uses existing SDK + mutation helpers |
| `src/standalone/internal/routes/tasks.ts` | Global task CRUD, attachments, comments, logs, task actions/forms | Reuses mutation services and common filters |
| `src/standalone/internal/routes/system.ts` | Columns/settings/webhooks/labels/workspace/auth/storage, legacy endpoints, static/SPA fallback | Keeps unmatched `/api/*` and asset fallback behavior in one place |
| `src/standalone/server.ts` | Orchestration-only entry point that composes runtime + handlers | Thin composition layer for the later Fastify migration |

## Compatibility gaps / mitigations

- No intentional external compatibility gaps were introduced in T1/T2.
- Temp editor cleanup is now explicitly attached to `server.close()` in addition to the existing watcher teardown path; this is a leak-prevention tightening rather than a contract change.
- Existing standalone helpers (`authUtils.ts`, `broadcastService.ts`, `cardHelpers.ts`, `mutationService.ts`, `watcherSetup.ts`, `messageHandlers.ts`) remain the source of truth for business logic during extraction.
