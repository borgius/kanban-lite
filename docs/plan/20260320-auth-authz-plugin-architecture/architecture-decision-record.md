# ADR: SDK-first auth/authz plugin architecture for Node-hosted surfaces

- **Status:** Accepted
- **Date:** 2026-03-20
- **Plan:** `docs/plan/20260320-auth-authz-plugin-architecture/plan.yaml`
- **Research:** `docs/plan/20260320-auth-authz-plugin-architecture/research_findings_auth_authz_plugin_architecture.yaml`

## Context

The repository already uses an SDK-first architecture and has a provider/capability model for storage. `src/sdk/KanbanSDK.ts` is the shared orchestration seam used by the standalone HTTP server, VS Code extension host, CLI, and MCP server. `src/shared/config.ts` already models provider references and capability normalization.

The auth/authz initiative needs a design that:

- supports both identity and policy plugin capabilities,
- preserves parity across standalone, extension, CLI, and MCP,
- keeps business logic out of interface layers,
- works with token-based authentication in v1,
- avoids insecure token handling, and
- defers row/card filtering until a later stage.

## Decision

We will implement auth/authz as **two new Node-hosted plugin capabilities** resolved by the SDK:

| Capability | Responsibility | v1 scope |
| --- | --- | --- |
| `auth.identity` | Accept token-oriented input and resolve a normalized principal/claims result | Token validation, principal shaping, auth status |
| `auth.policy` | Decide whether a named SDK action is permitted for a resolved principal and target context | Pre-action authorization only |

### Accepted scope boundaries

1. **SDK-first enforcement:** all identity resolution and authorization checks happen in SDK-owned code, not in REST/CLI/MCP/extension handlers.
2. **Token-based auth in v1:** hosts provide bearer-token or equivalent token input; interactive browser/OAuth flows are out of scope for the first release.
3. **Action-level authorization only in v1:** policy plugins can allow or deny named actions such as create/update/delete/submit/transfer, but they do not filter card lists, board lists, or attachment sets.
4. **Node-hosted plugins only in v1:** plugins run only in Node-hosted environments. The webview never loads or executes auth/authz plugins.
5. **Host-owned token storage:** token acquisition/storage is adapter-specific:
   - VS Code extension: `SecretStorage`
   - standalone server: in-memory and/or explicit config sources
   - CLI and MCP: environment variables and/or explicit config sources
6. **No secrets in `.kanban.json`:** workspace config may select auth providers, but it must not store raw bearer tokens.

## Concrete design

### 1. Capability and config model

The existing provider reference model in `src/shared/config.ts` should be extended with two new capability namespaces:

- `auth.identity`
- `auth.policy`

Provider references belong in workspace/runtime configuration the same way storage providers do, but token material does not. Provider config may include non-secret options such as issuer hints, audience names, header names, or policy package identifiers.

### 2. Shared auth context

Every privileged SDK call should be able to receive a normalized auth context assembled by the host adapter. The minimum v1 context should include:

- transport surface (`standalone`, `extension`, `cli`, `mcp`),
- token source metadata,
- raw token input (write-only at the host boundary),
- optional actor hint,
- target resource hints such as board/card id, and
- the canonical action name being authorized.

The host supplies this context; the SDK consumes it.

### 3. SDK runtime responsibilities

`src/sdk/KanbanSDK.ts` becomes the single owner of the auth runtime:

1. Resolve configured `auth.identity` and `auth.policy` providers during initialization.
2. Build a normalized auth/authz service layer around those providers.
3. Resolve the principal from token input.
4. Run a pre-action policy check before the underlying operation executes.
5. Return stable success/deny/error semantics to all callers.

This keeps parity intact because every interface layer delegates into the same SDK enforcement path.

### 4. Host adapter responsibilities

Host layers stay intentionally thin:

- **Standalone server (`src/standalone/server.ts`)** extracts request token/context and passes it into SDK calls.
- **Extension host (`src/extension/index.ts`, `src/extension/KanbanPanel.ts`)** stores tokens in `SecretStorage`, maps command/webview actions into SDK auth contexts, and never exposes raw token material to the webview bundle.
- **CLI (`src/cli/index.ts`)** resolves token input from env/config/flags and passes it into SDK calls.
- **MCP (`src/mcp-server/index.ts`)** resolves token input from env/config and passes it into SDK tool handlers.

None of these layers may implement policy decisions directly.

### 5. Authorization boundary in v1

The first release authorizes **actions**, not query results.

Examples of v1 action names:

- `board.create`
- `board.update`
- `board.delete`
- `card.create`
- `card.update`
- `card.delete`
- `card.transfer`
- `comment.add`
- `attachment.add`
- `attachment.open`
- `form.submit`
- `settings.update`

The exact final action matrix should be defined in source contracts and tests, but the important boundary is fixed now: the policy plugin returns allow/deny for named operations before they execute.

## Consequences

### Positive

- Reuses the repository’s existing capability/plugin direction instead of introducing a second plugin framework.
- Keeps authorization behavior aligned across SDK, API, CLI, MCP, and extension flows.
- Preserves the AGENTS rule that business logic lands in the SDK first.
- Limits v1 complexity by avoiding list filtering and storage-query rewrites.
- Lets each host use an appropriate token storage mechanism without forcing a single runtime secret model.

### Trade-offs

- Some read operations may remain effectively coarse-grained in v1 because row/card filtering is deferred.
- Host adapters still need targeted work to normalize token precedence and UX across environments.
- Future support for richer auth flows (refresh, impersonation, interactive login, scoped filtering) requires a second-stage design.

## Rejected alternatives

### Browser-hosted plugins in the webview

Rejected because the webview is not a privileged plugin host and should not receive or execute token-bearing auth logic.

### Host-specific authorization logic in REST/CLI/MCP/extension handlers

Rejected because it would immediately create parity drift and bypass risk. The SDK is already the shared orchestration layer.

### Row/card filtering in v1

Rejected because current storage and list contracts do not define partial visibility semantics. Introducing filtering now would expand the initiative from pre-action enforcement into query/storage redesign.

## Implementation direction

The implementation sequence should follow the repository rule set:

1. **SDK first** — capability contracts, auth context types, identity resolution, and policy decision hooks in the SDK/plugin layer.
2. **API** — standalone server request mapping and status/error parity.
3. **CLI** — token-source wiring and consistent auth diagnostics.
4. **MCP** — token-source wiring and consistent tool-level denial semantics.
5. **Extension** — SecretStorage-backed adapter and extension/webview status UX.

## Stage relationship

This ADR is the accepted stage-1 baseline. Detailed follow-on requirements for stage 2 live in:

- `docs/plan/20260320-auth-authz-plugin-architecture/architecture-requirements-stage-2.md`
