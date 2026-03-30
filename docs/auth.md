# Auth plugins and auth capabilities

This document is the detailed reference for Kanban Lite's auth system as it exists today in the codebase.

It explains:

- what the auth plugin capabilities are,
- how they are configured,
- how the SDK evaluates authorization,
- how each host surface passes tokens into the SDK,
- which actions are currently protected,
- what diagnostics are available,
- and what is intentionally **not** implemented yet.

This guide is deliberately more detailed than the short auth section in `README.md` and more implementation-focused than the ADR/plan documents under `docs/plan/20260320-auth-authz-plugin-architecture/`.

---

## Executive summary

Kanban Lite models auth as **two capability namespaces**:

- `auth.identity`
- `auth.policy`

Those capabilities are resolved by the SDK in the same general style as storage capabilities.

The key rule is:

> If no auth plugin is configured, behavior must not change.

That rule is preserved by **no-op** providers resolved from `kl-auth-plugin` when available (with a core compatibility fallback when the package is absent):

- `auth.identity: noop` → always resolves to anonymous (`null` identity)
- `auth.policy: noop` → always allows the action

The current release also ships a **starter RBAC** provider pair through `kl-auth-plugin`:

- `auth.identity: rbac` → validates opaque tokens against a runtime-owned principal registry
- `auth.policy: rbac` → enforces a fixed cumulative role matrix for `user`, `manager`, and `admin`

So a workspace with no auth configuration continues to behave exactly like an open-access workspace.

When a non-noop auth provider is active, the SDK performs **pre-action authorization** at the SDK method boundary before protected work executes.

---

## Getting started: fresh install with the local auth plugin

This section walks a new user through installing Kanban Lite in an empty folder with the `local` auth provider enabled so that the UI and REST API are protected by a username/password login and an API bearer token.

### Prerequisites

- Node.js ≥ 18
- npm, pnpm, or yarn

### Step 1 — create a project folder and initialise it

```bash
mkdir my-kanban && cd my-kanban
npm init -y
```

### Step 2 — install kanban-lite and the auth plugin

```bash
npm install kanban-lite kl-auth-plugin
```

The standalone server binary is installed at `node_modules/.bin/kanban-lite` (or at the `kanban-lite` bin if you use npm scripts).

### Step 3 — generate bcrypt password hashes

The `local` provider stores passwords as bcrypt hashes, never plain text. Generate one hash per user:

```bash
node -e "require('bcryptjs').hash('admin123', 12).then(h => console.log('admin   :', h))"
node -e "require('bcryptjs').hash('manager123', 12).then(h => console.log('manager :', h))"
node -e "require('bcryptjs').hash('user123', 12).then(h => console.log('user    :', h))"
```

Copy the three output strings — you will paste them into `.kanban.json` in the next step.

### Step 4 — create `.kanban.json` with local auth

Create a `.kanban.json` file in your project root (substitute the hashes from Step 3):

```json
{
  "version": 2,
  "port": 2954,
  "plugins": {
    "auth.identity": {
			"provider": "local",
      "options": {
        "users": [
          { "username": "admin",   "password": "<bcrypt-hash-for-admin>",   "role": "admin" },
          { "username": "manager", "password": "<bcrypt-hash-for-manager>", "role": "manager" },
          { "username": "user",    "password": "<bcrypt-hash-for-user>",    "role": "user" }
        ]
      }
    },
		"auth.policy": { "provider": "local" }
  }
}
```

What each field does:

| Field | Purpose |
|-------|---------|
| `auth.identity.provider = "local"` | Resolves identity from a browser session cookie (set after `/auth/login`) or from the `Authorization: Bearer <token>` header |
| `auth.identity.options.users` | List of allowed username/bcrypt-password pairs for browser login. Each entry may include an optional `role` (`user`, `manager`, or `admin`) to enforce RBAC permissions |
| `auth.policy.provider = "local"` | Allows any authenticated caller; denies anonymous requests |

### Step 5 — set the API bearer token in `.env`

The `local` provider also accepts a shared API token for programmatic access (MCP, CLI calls, REST scripts). Generate one and put it in `.env`:

```bash
node -e "const c=require('crypto');console.log('KANBAN_LITE_TOKEN=kl-'+c.randomBytes(24).toString('hex'))"
```

Append the printed line to `.env`:

```
KANBAN_LITE_TOKEN=kl-<your-generated-token>
```

> The `local` provider reads `KANBAN_LITE_TOKEN` (or the fallback `KANBAN_TOKEN`) from the environment at startup. If neither is set, it auto-generates a token and writes it to `.env` the first time the server starts.

### Step 6 — start the server

```bash
npx kanban-lite
# or, if you added it to package.json scripts:
npm start
```

On first start you should see something like:

```
Kanban Lite listening on http://localhost:2954
Auth: local (identity) + local (policy)
```

### Step 7 — log in via the browser

Open `http://localhost:2954` in a browser. You will be redirected to `/auth/login`. Enter one of the usernames and passwords from Step 4. After a successful login you are redirected back and a session cookie is set — subsequent browser requests are authenticated automatically.

Log out at any time by visiting `http://localhost:2954/auth/logout`.

### Step 8 — authenticate programmatic / REST calls

Pass the token from `.env` as a bearer token:

```bash
curl -H "Authorization: Bearer kl-<your-token>" \
  http://localhost:2954/api/boards
```

MCP calls running inside the same shell automatically pick up `KANBAN_LITE_TOKEN` from the environment. CLI calls do the same, or you can pass `--token <value>` for a one-off invocation.

### What is still open-access

The `local` policy provider allows **any** authenticated identity and denies **anonymous** callers. It does not enforce role-based restrictions between `admin`, `manager`, and `user`. If you need role-based access control, configure the `rbac` provider pair instead and supply a principal registry at runtime (see the [Starter RBAC provider](#starter-rbac-provider) section below).

---

## Design goals

The auth design is built around a few principles:

1. **SDK first**
	 - The SDK is the authoritative enforcement seam.
	 - REST, CLI, MCP, and the extension host must not implement their own allow/deny rules.

2. **Host-owned token acquisition**
	 - Each host decides where a token comes from.
	 - The SDK consumes a normalized `AuthContext`.

3. **Schema-defined provider options**
	 - Workspace config persists selected provider ids and documented provider options.
	 - Shared Plugin Options read/list/error flows redact secret fields and reopen them as masked write-only placeholders instead of redisplaying raw values.

4. **Action-level authorization only**
	 - Current authorization is based on named SDK actions.
	 - It does not do partial filtering of card lists or board lists.

5. **No-plugin = no behavior change**
	 - The default path remains anonymous + allow-all via `noop`, with a compatibility fallback when `kl-auth-plugin` is not installed yet.

---

## Capability model

Auth uses two capability namespaces defined in `src/shared/config.ts`:

- `AuthCapabilityNamespace = 'auth.identity' | 'auth.policy'`
- `AuthCapabilitySelections = Partial<Record<AuthCapabilityNamespace, ProviderRef>>`
- `ResolvedAuthCapabilities = Record<AuthCapabilityNamespace, ProviderRef>`

The same `ProviderRef` shape used by storage capabilities is reused here:

```ts
interface ProviderRef {
	provider: string
	options?: Record<string, unknown>
}
```

That means auth provider selection looks structurally like storage provider selection.

---

## The two auth capabilities

### `auth.identity`

Responsibility:

- take a host-supplied `AuthContext`,
- inspect token-related input,
- and resolve a normalized caller identity.

The runtime identity shape is defined in `src/sdk/plugins/index.ts`:

```ts
export interface AuthIdentity {
	subject: string
	roles?: string[]
}
```

Current shipped provider ids:

- `noop`
- `rbac`
- `local`

Current `noop` behavior:

- always returns `null`
- treats the caller as anonymous
- preserves open-access behavior when no real identity plugin is active

Current `rbac` behavior:

- treats tokens as opaque strings
- strips a `Bearer ` prefix defensively before lookup
- resolves identity from a runtime-owned principal registry (`token -> { subject, roles }`)
- returns `null` for absent or unregistered tokens
- never infers roles from token text

Important implementation detail:

- the exported singleton `RBAC_IDENTITY_PLUGIN` is constructed with an **empty** principal registry
- that means selecting `auth.identity = rbac` resolves a real provider id, but no token will authenticate until the host/runtime supplies principal material via `createRbacIdentityPlugin(principals)` and injects that plugin through custom capability wiring

Current `local` behavior:

Identity is resolved in the following priority order:

1. **Pre-installed identity** — if `context.identity` is already set (e.g. from a valid session cookie installed by the `standalone.http` middleware), that identity is returned directly.
2. **API bearer token** — if `Authorization: Bearer <token>` matches the `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` environment variable, the identity `{ subject: context.actorHint ?? 'api-token' }` is returned.
3. **Actor hint** — if `context.actorHint` is present (e.g. set by the CLI or MCP surface), that value becomes the subject.
4. **`null`** — anonymous caller; the local policy will deny the request.

Important implementation details:

- `KANBAN_LITE_TOKEN` takes precedence over the fallback `KANBAN_TOKEN`
- token comparison uses `crypto.timingSafeEqual` to prevent timing attacks
- a `Bearer ` prefix is stripped before comparison
- the exported singleton `LOCAL_IDENTITY_PLUGIN` is stateless and suitable for standalone use
- when the `local` provider is active inside the standalone server, `createStandaloneHttpPlugin` auto-generates a `kl-…` token and persists it to `<workspaceRoot>/.env` if neither env var is set

### `auth.policy`

Responsibility:

- receive the resolved identity,
- receive the canonical action name,
- receive the normalized `AuthContext`,
- return an allow/deny decision.

The decision shape is defined in `src/sdk/types.ts`:

```ts
export interface AuthDecision {
	allowed: boolean
	reason?: AuthErrorCategory
	actor?: string
	metadata?: Record<string, unknown>
}
```

Current shipped provider ids:

- `noop`
- `rbac`
- `local`

Current `noop` behavior:

- always returns `{ allowed: true }`
- allows every protected action
- preserves open-access behavior when no real policy plugin is active

Current `rbac` behavior:

- denies `null` identity with `reason = 'auth.identity.missing'`
- checks the caller's roles against the fixed `RBAC_ROLE_MATRIX`
- returns `{ allowed: true, actor: identity.subject }` on success
- returns `{ allowed: false, reason: 'auth.policy.denied', actor: identity.subject }` when the action is outside the caller's role set
- implements three cumulative roles: `user`, `manager`, and `admin`

Current `local` behavior:

- denies `null` identity with `reason = 'auth.identity.missing'`
- allows **all** actions for any non-null identity (`{ allowed: true, actor: identity.subject }`)
- does **not** enforce role distinctions — every authenticated caller has equal access
- intended for single-operator setups or when role separation is not required

---

## Current implementation status

This part is important because the **architecture** is slightly broader than the **currently shipped resolver behavior**.

### What exists today

Today the codebase includes:

- auth capability types in config,
- auth plugin interfaces,
- `kl-auth-plugin` package with three fully-shipped provider ids: `noop`, `rbac`, and `local`,
- `noop` identity/policy providers that preserve open-access behavior,
- `rbac` identity/policy providers with runtime-backed token registry,
- `local` identity/policy providers for username/password + API token auth,
- `createStandaloneHttpPlugin` — registers `/auth/login`, `/auth/logout`, and identity middleware for the `local` provider,
- the exported `createRbacIdentityPlugin(principals)` helper for runtime-backed token validation,
- the fixed `RBAC_USER_ACTIONS`, `RBAC_MANAGER_ACTIONS`, `RBAC_ADMIN_ACTIONS`, and `RBAC_ROLE_MATRIX` exports,
- `RbacRole` type (`'user' | 'manager' | 'admin'`),
- listener runtime helpers: `createAuthListenerPlugin`, `createLocalAuthListenerPlugin`, `createNoopAuthListenerPlugin`, `createRbacAuthListenerPlugin`,
- the `ProviderBackedAuthListenerPlugin` class for custom listener wiring,
- `authListenerPluginFactories` convenience map,
- `authIdentityPlugins` and `authPolicyPlugins` provider registries,
- SDK auth status reporting,
- SDK pre-action authorization hooks,
- normalized host `AuthContext` wiring for standalone, CLI, MCP, and extension host surfaces,
- auth diagnostics/status endpoints and commands,
- tests for the auth seam and host wiring.

### What is still intentionally limited

The shipped auth provider ids are:

- `auth.identity.provider = "noop" | "rbac" | "local"`
- `auth.policy.provider = "noop" | "rbac" | "local"`

If another provider id is selected, the resolver treats it as an external package name and throws an actionable install/shape error when the package cannot be loaded.

So the system now has:

- the **capability contract**,
- the **SDK enforcement seam**,
- the built-in **`noop`** open-access default,
- the built-in **starter `rbac`** policy implementation,
- the turnkey **`local`** username/password + API token provider with a browser login UI,
- and the **host integration path for token acquisition**.

One remaining limitation:

- The shipped `RBAC_IDENTITY_PLUGIN` singleton uses an empty registry; real RBAC token validation requires host/runtime wiring via `createRbacIdentityPlugin(principals)`. The `local` provider does not have this limitation — it works out of the box with `.kanban.json` user config.

---

## Configuration

Auth now participates in the same shared **Plugin Options** workflow as other plugin-backed capabilities. The settings UI discovers auth providers from installed packages, shows the supplying package separately from the provider id, and persists the selected provider id plus its options under `.kanban.json -> plugins`.

For auth, the package is typically `kl-auth-plugin`, while the selected provider ids are usually `local`, `rbac`, or `noop`. The legacy `provider: "kl-auth-plugin"` alias remains available for compatibility, but the shared workflow selects the explicit provider rows and does not use a separate auth-enabled boolean.

### Shared Plugin Options workflow

- Install or discover `kl-auth-plugin`.
- Open **Settings → Plugin Options**.
- Select a provider row for `auth.identity` and `auth.policy` (for example `local` or `rbac`).
- Save provider options from the schema-driven form generated by the provider's `optionsSchema()` output.
- The selected provider id is persisted at `plugins["auth.identity"].provider` / `plugins["auth.policy"].provider`; selecting a provider is the enablement state.

Secret-bearing auth fields participate in the same masked edit flow as other providers:

- `auth.identity.options.apiToken`
- `auth.identity.options.users[*].password`

Those values reopen as `••••••` in the shared workflow. Leaving the masked placeholder unchanged keeps the stored secret/hash, and typing a new value replaces it. Read/list/error payloads stay redacted and do not redisplay the raw stored value.

### Default (no auth)

Omit auth namespaces entirely — the SDK defaults both to `noop` (open-access).

### Local provider config

Requires `kl-auth-plugin` installed. Passwords are bcrypt hashes (cost 12 recommended):

```json
{
	"plugins": {
		"auth.identity": {
			"provider": "local",
			"options": {
				"users": [
					{ "username": "admin",   "password": "$2b$12$...", "role": "admin" },
					{ "username": "manager", "password": "$2b$12$...", "role": "manager" },
					{ "username": "user",    "password": "$2b$12$...", "role": "user" }
				]
			}
		},
		"auth.policy": { "provider": "local" }
	}
}
```

Set `KANBAN_LITE_TOKEN` in `.env` for API bearer token access (auto-generated if absent):

```
KANBAN_LITE_TOKEN=kl-<48-hex-chars>
```

### Starter RBAC config

```json
{
	"plugins": {
		"auth.identity": { "provider": "rbac" },
		"auth.policy": { "provider": "rbac" }
	}
}
```

What this does in the current implementation:

- switches both auth capability ids to the `rbac` provider pair supplied by `kl-auth-plugin`
- enables action-level authorization using the fixed SDK-owned role matrix
- requires the host/runtime to provide the principal registry used by `createRbacIdentityPlugin(principals)` if you want any token to resolve successfully

What this does **not** do:

- it does not store token-to-role mappings in `.kanban.json`
- it does not create a login flow
- it does not make the empty-registry `RBAC_IDENTITY_PLUGIN` singleton accept arbitrary token text

### Shape of auth config (full example)

```json
{
	"plugins": {
		"auth.identity": {
			"provider": "local",
			"options": {}
		},
		"auth.policy": {
			"provider": "local",
			"options": {}
		}
	}
}
```

### Normalization behavior

`normalizeAuthCapabilities()` in `src/shared/config.ts` guarantees that both auth namespaces are always resolved.

Lookup order: `plugins["auth.identity"]` → `{ provider: "noop" }`.

If both `plugins` auth keys and the `auth` key are omitted entirely, the normalized result is:

```json
{
	"auth.identity": { "provider": "noop" },
	"auth.policy": { "provider": "noop" }
}
```

So there is always a complete runtime auth capability map, even when the workspace has no auth config.

### What belongs in `.kanban.json` and what does not

For auth providers, `.kanban.json` persists the selected provider ids plus documented provider options from the shared schema-driven workflow. That can include:

- `auth.identity.options.users` entries (with bcrypt password hashes),
- `auth.identity.options.apiToken` when you intentionally pin an explicit API token,
- and `auth.policy.options.matrix` overrides.

The Plugin Options workflow never redisplays raw secret values for those fields. Instead, secret-bearing paths reopen masked as `••••••`, and read/list/error payloads stay redacted.

Still do **not** store runtime-only or unrelated secrets such as:

- session cookies,
- cookie-signing or session secrets,
- refresh tokens,
- CSRF secrets,
- or credentials that are not part of the provider's documented schema.

---

## Auth plugin contracts

The core auth plugin contracts live in `src/sdk/plugins/index.ts`.

### Identity plugin contract

```ts
export interface AuthIdentityPlugin {
	readonly manifest: AuthPluginManifest
	resolveIdentity(context: AuthContext): Promise<AuthIdentity | null>
}
```

### Policy plugin contract

```ts
export interface AuthPolicyPlugin {
	readonly manifest: AuthPluginManifest
	checkPolicy(
		identity: AuthIdentity | null,
		action: string,
		context: AuthContext
	): Promise<AuthDecision>
}
```

### Auth plugin manifest

```ts
export interface AuthPluginManifest {
	readonly id: string
	readonly provides: readonly AuthCapabilityNamespace[]
}
```

That means an auth plugin identifies itself by:

- a provider id,
- and the auth namespace(s) it implements.

### Starter RBAC helper contract

The built-in starter RBAC implementation also exports a small runtime helper contract:

```ts
export interface RbacPrincipalEntry {
	subject: string
	roles: string[]
}

export function createRbacIdentityPlugin(
	principals: ReadonlyMap<string, RbacPrincipalEntry>,
): AuthIdentityPlugin
```

That helper is the runtime-backed identity path for the shipped `rbac` provider:

- keys are opaque tokens
- values contain the resolved caller `subject` and `roles`
- unknown tokens resolve to `null`
- roles come from runtime-owned data, not token parsing

The built-in singleton `RBAC_IDENTITY_PLUGIN` simply calls this helper with `new Map()`.

---

## `local` provider — standalone.http capability

When either auth capability resolves to a provider supplied by `kl-auth-plugin` (for example `local` or the legacy `kl-auth-plugin` alias), the standalone server automatically loads the `standalone.http` capability exported by `createStandaloneHttpPlugin` from `kl-auth-plugin`.

### What it registers

**Middleware** (runs before every request):

- reads `Authorization: Bearer <token>` and compares it to the workspace API token using `crypto.timingSafeEqual`
- reads the `kanban_lite_session` cookie and looks up the session in an in-memory store
- if neither succeeds:
  - API requests (`/api/...`) → `401 { ok: false, error: "Authentication required" }`
  - Page requests → `302` redirect to `/auth/login?returnTo=<current path>`

**Routes**:

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/auth/login` | Serves the login HTML form. Redirects to `returnTo` if already authenticated. |
| `POST` | `/auth/login` | Verifies username + bcrypt password. On success: sets session cookie, redirects to `returnTo`. On failure: re-renders form with error. Accepts both `application/json` and `application/x-www-form-urlencoded`. |
| `GET` or `POST` | `/auth/logout` | Deletes the session, clears the cookie, redirects to `/auth/login`. |

### Session details

| Property | Value |
|---|---|
| Cookie name | `kanban_lite_session` |
| Cookie flags | `HttpOnly; SameSite=Lax; Path=/` |
| TTL | 7 days |
| Storage | In-memory `Map` (lost on server restart) |
| Session ID | 24 random bytes, hex-encoded |

### API token auto-provisioning

On startup, `createStandaloneHttpPlugin` calls `ensureWorkspaceApiToken(workspaceRoot)`:

1. Checks `KANBAN_LITE_TOKEN` and `KANBAN_TOKEN` environment variables.
2. If found, uses that value (and back-fills `process.env.KANBAN_LITE_TOKEN` if only `KANBAN_TOKEN` was set).
3. If neither is set, generates a `kl-<48-hex-chars>` token, writes `KANBAN_LITE_TOKEN=<token>` to `<workspaceRoot>/.env`, and sets `process.env.KANBAN_LITE_TOKEN`.

### Security notes

- Passwords are never stored in plain text — only bcrypt hashes in `.kanban.json`.
- Token comparison uses `crypto.timingSafeEqual` to prevent timing attacks.
- `returnTo` is validated to reject external redirects (must start with `/` and must not start with `//`).
- The login form HTML-escapes all user-supplied values before rendering.
- Session IDs are cryptographically random; they are never derived from user input.

---

## Listener runtime helpers

`kl-auth-plugin` exports a set of standalone listener helpers that plug into the SDK event bus directly, separate from the capability-provider path. These are useful when you want to enforce auth from application code rather than from `.kanban.json` config.

### `ProviderBackedAuthListenerPlugin`

The underlying class that all factory functions produce:

```ts
class ProviderBackedAuthListenerPlugin implements SDKEventListenerPlugin {
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }

  constructor(
    authIdentity: AuthIdentityPlugin,
    authPolicy: AuthPolicyPlugin,
    options?: AuthListenerPluginOptions,
  )

  register(bus: EventBus): void
  unregister(): void
}
```

Registers across **all** SDK before-events. For each event it:

1. Merges the request-scoped `AuthContext` (from `options.getAuthContext?.()`) with event payload hints.
2. Calls `authIdentity.resolveIdentity(context)`.
3. Calls `authPolicy.checkPolicy(identity, action, context)`.
4. On denial: emits `auth.denied` and throws `AuthError`.
5. On success: emits `auth.allowed` and optionally returns `options.overrideInput(...)` as an input override.

### `AuthListenerPluginOptions`

```ts
interface AuthListenerPluginOptions {
  id?: string
  getAuthContext?: () => AuthContext | undefined
  overrideInput?: (context: AuthListenerOverrideContext) =>
    BeforeEventListenerResponse | Promise<BeforeEventListenerResponse>
}
```

| Field | Purpose |
|---|---|
| `id` | Custom plugin manifest id (defaults to `auth-listener:<identity id>:<policy id>`). |
| `getAuthContext` | Callback that returns the active request-scoped `AuthContext`. Use this to thread auth from your host surface into the listener. |
| `overrideInput` | Optional callback called **after** a successful auth decision. Return a plain object to deep-merge into the before-event input. |

### `AuthListenerOverrideContext`

Passed to `overrideInput`:

```ts
interface AuthListenerOverrideContext {
  readonly payload: BeforeEventPayload<Record<string, unknown>>
  readonly identity: AuthIdentity | null
  readonly decision: AuthDecision
}
```

### Factory functions

```ts
// Wrap any identity+policy pair
createAuthListenerPlugin(
  identity: AuthIdentityPlugin,
  policy: AuthPolicyPlugin,
  options?: AuthListenerPluginOptions,
): ProviderBackedAuthListenerPlugin

// local provider pair
createLocalAuthListenerPlugin(
  options?: AuthListenerPluginOptions,
): ProviderBackedAuthListenerPlugin

// noop provider pair (open-access)
createNoopAuthListenerPlugin(
  options?: AuthListenerPluginOptions,
): ProviderBackedAuthListenerPlugin

// rbac provider pair with optional principal registry
createRbacAuthListenerPlugin(
  principals?: ReadonlyMap<string, RbacPrincipalEntry>,
  options?: AuthListenerPluginOptions,
): ProviderBackedAuthListenerPlugin
```

### `authListenerPluginFactories`

A convenience map keyed by provider id:

```ts
const authListenerPluginFactories: {
  local: typeof createLocalAuthListenerPlugin
  noop:  typeof createNoopAuthListenerPlugin
  rbac:  typeof createRbacAuthListenerPlugin
}
```

### `auth.allowed` and `auth.denied` events

Both events are emitted on the SDK event bus by the listener after every authorization decision:

```ts
// auth.allowed
{
  type: 'auth.allowed',
  data: { action: string, actor?: string },
  timestamp: string,
  actor?: string,
  boardId?: string,
}

// auth.denied
{
  type: 'auth.denied',
  data: { action: string, actor?: string, reason: AuthErrorCategory },
  timestamp: string,
  actor?: string,
  boardId?: string,
}
```

---

## Plugin registries

`kl-auth-plugin` exports two flat registry objects for programmatic plugin lookup:

```ts
const authIdentityPlugins: Record<string, AuthIdentityPlugin> = {
  local: LOCAL_IDENTITY_PLUGIN,
  noop:  NOOP_IDENTITY_PLUGIN,
  rbac:  RBAC_IDENTITY_PLUGIN,   // empty principal registry
}

const authPolicyPlugins: Record<string, AuthPolicyPlugin> = {
  local: LOCAL_POLICY_PLUGIN,
  noop:  NOOP_POLICY_PLUGIN,
  rbac:  RBAC_POLICY_PLUGIN,
}
```

These are used by the SDK's capability resolver to look up providers by the id string from `.kanban.json`. You can also use them directly in application code:

```ts
import { authIdentityPlugins, authPolicyPlugins } from 'kl-auth-plugin'

const identity = authIdentityPlugins['local']
const policy   = authPolicyPlugins['local']
```

---

## Starter RBAC provider

The current shipped RBAC contract is intentionally small and fixed.

### Canonical roles

- `user`
- `manager`
- `admin`

Roles are cumulative upward:

- `manager` includes every `user` action
- `admin` includes every `manager` and `user` action

### Identity-side behavior

- token validation is runtime-owned
- token values are opaque strings
- a defensive `Bearer ` prefix strip happens before the registry lookup
- the resolved identity shape is still just:

```ts
{ subject: string, roles?: string[] }
```

### Policy-side behavior

The built-in `rbac` policy provider consumes `RBAC_ROLE_MATRIX`.

- `null` identity → deny with `auth.identity.missing`
- action not covered by the caller's role set → deny with `auth.policy.denied`
- allowed action → returns the caller subject as `actor`

### Runtime boundary

The current built-in RBAC provider is **Node-hosted only**.

- hosts are responsible for token acquisition
- hosts are responsible for any runtime principal material
- the webview is not an auth plugin host
- `.kanban.json` selects providers but does not contain token registries or secrets

---

## The auth context passed into the SDK

Hosts normalize token-related information into `AuthContext` from `src/sdk/types.ts`.

Important fields include:

- `token?: string`
- `tokenSource?: string`
- `transport?: string`
- `actorHint?: string`
- `boardId?: string`
- `cardId?: string`
- `fromBoardId?: string`
- `toBoardId?: string`
- `columnId?: string`
- `commentId?: string`
- `formId?: string`
- `attachment?: string`
- `labelName?: string`
- `webhookId?: string`
- `actionKey?: string`

### Why `AuthContext` exists

It gives the SDK one transport-neutral structure so the same authorization seam can work across:

- HTTP requests,
- WebSocket calls,
- CLI commands,
- MCP tools,
- and extension-host actions.

### What the fields are for

- `token` is the write-only credential input for identity resolution.
- `tokenSource` is diagnostics-only metadata such as `request-header`, `env`, or `secret-storage`.
- `transport` identifies the surface such as `http`, `cli`, `mcp`, or `extension`.
- resource hint fields let the policy plugin evaluate context-rich actions like:
	- deleting a specific card,
	- renaming a specific label,
	- transferring between boards,
	- submitting a specific form,
	- or triggering a named action.

---

## SDK runtime flow

The auth runtime is centered in `src/sdk/KanbanSDK.ts`.

### Step 1: resolve configured auth capabilities

During SDK construction, auth capabilities are resolved via workspace config normalization.

### Step 2: resolve capability bag

The resolved capability bag contains both:

- `authIdentity`
- `authPolicy`

If no auth config is present, both are no-op plugins.

### Step 3: host surfaces install scoped auth

Node-hosted surfaces create an `AuthContext` from their inbound token source and call:

- `sdk.runWithAuth(authContext, fn)`

This stores request auth in an async scope for the duration of `fn` instead of threading auth through mutation method signatures.

### Step 4: protected methods enter the before-event seam

Protected SDK mutators call:

- `_runBeforeEvent(event, input, actor?, boardId?)`

`_runBeforeEvent()` clones the original input immediately, dispatches the before-event payload, and owns the immutable deep-merge of any listener overrides.

### Step 5: the built-in auth listener resolves identity and policy

The built-in auth listener reads the request-scoped auth carrier installed by `runWithAuth()`, enriches it with event hints such as `actor` and `boardId`, and then calls:

```ts
const identity = await authIdentity.resolveIdentity(context)
const decision = await authPolicy.checkPolicy(identity, action, context)
```

First-party auth listeners do **not** read `payload.auth`; `BeforeEventPayload` no longer carries auth state.

### Step 6: denial vetoes the mutation with `AuthError`

If `decision.allowed` is false, the SDK throws `AuthError`.

That is what host surfaces use to map errors to:

- HTTP status codes,
- CLI output,
- MCP tool errors,
- and extension-host messages.

---

## Sequence diagram

```mermaid
sequenceDiagram
	participant Host as Host surface
	participant SDK as KanbanSDK
	participant Runner as _runBeforeEvent
	participant Listener as Built-in auth listener
	participant Identity as auth.identity
	participant Policy as auth.policy
	participant Op as Target operation

	Host->>SDK: runWithAuth(authContext, fn)
	Host->>SDK: call mutation(input)
	SDK->>Runner: _runBeforeEvent(event, input, actor?, boardId?)
	Runner->>Listener: dispatch BeforeEventPayload
	Listener->>Identity: resolveIdentity(scoped context + hints)
	Identity-->>SDK: identity | null
	Listener->>Policy: checkPolicy(identity, action, context)
	Policy-->>SDK: AuthDecision
	alt allowed
		Runner-->>SDK: merged input
		SDK->>Op: execute mutation
		Op-->>SDK: result
		SDK-->>Host: success
	else denied
		Listener-->>Host: throw AuthError
	end
```

---

## Auth decisions and error categories

`AuthErrorCategory` in `src/sdk/types.ts` defines the canonical auth failure vocabulary.

Current categories are:

- `auth.identity.missing`
- `auth.identity.invalid`
- `auth.identity.expired`
- `auth.policy.denied`
- `auth.policy.unknown`
- `auth.provider.error`

### Why categories matter

These categories let hosts map failures without parsing fragile human-readable strings.

Examples:

- HTTP can turn identity failures into `401`
- HTTP can turn deny failures into `403`
- CLI can print a targeted auth message
- MCP can return machine-usable tool errors

### `AuthError`

`AuthError` is the typed SDK error used when a protected action is denied.

It carries:

- a machine-readable category,
- a human-readable message,
- and optional actor information.

---

## Current protected action surface

The current implementation protects the following SDK operations through the SDK-owned before-event auth listener that runs inside `_runBeforeEvent(...)`.

### Built-in RBAC role matrix

#### `user`

- `form.submit`
- `comment.create`
- `comment.update`
- `comment.delete`
- `attachment.add`
- `attachment.remove`
- `card.action.trigger`
- `log.add`

#### `manager`

Includes all `user` actions plus:

- `card.create`
- `card.update`
- `card.move`
- `card.transfer`
- `card.delete`
- `board.action.trigger`
- `log.clear`
- `board.log.add`

#### `admin`

Includes all `manager` and `user` actions plus:

- `board.create`
- `board.update`
- `board.delete`
- `settings.update`
- `webhook.create`
- `webhook.update`
- `webhook.delete`
- `label.set`
- `label.rename`
- `label.delete`
- `column.create`
- `column.update`
- `column.reorder`
- `column.setMinimized`
- `column.delete`
- `column.cleanup`
- `board.action.config.add`
- `board.action.config.remove`
- `board.log.clear`
- `board.setDefault`
- `storage.migrate`
- `card.purgeDeleted`

### Same surface grouped by operation area

#### Board actions

- `board.create`
- `board.update`
- `board.delete`
- `board.setDefault`
- `board.action.config.add`
- `board.action.config.remove`
- `board.action.trigger`
- `board.log.add`
- `board.log.clear`

#### Card actions

- `card.create`
- `card.update`
- `card.move`
- `card.delete`
- `card.transfer`
- `card.purgeDeleted`
- `card.action.trigger`

#### Form actions

- `form.submit`

#### Attachment actions

- `attachment.add`
- `attachment.remove`

#### Comment actions

- `comment.create`
- `comment.update`
- `comment.delete`

#### Log actions

- `log.add`
- `log.clear`

#### Column actions

- `column.create`
- `column.update`
- `column.reorder`
- `column.setMinimized`
- `column.delete`
- `column.cleanup`

#### Label actions

- `label.set`
- `label.rename`
- `label.delete`

#### Settings and storage actions

- `settings.update`
- `storage.migrate`

#### Webhook actions

- `webhook.create`
- `webhook.update`
- `webhook.delete`

### Important note on scope

Not every synchronous/local mutation path in the codebase is currently routed through the auth seam.

For example, the current action-protected surface is focused on the **privileged async mutation seam** already used by the Node-hosted adapters. The action matrix above is the authoritative list of what is currently protected.

This doc intentionally describes the implementation as it exists now, not as an aspirational superset.

---

## How scoped auth and before-event hints work

Hosts do not pass auth through every SDK mutator. Instead, they establish request scope once with `runWithAuth(...)`, and the SDK supplies operation hints when it dispatches each before-event.

Examples:

- a REST route extracts a bearer token, builds `{ token, tokenSource: 'request-header', transport: 'http' }`, and wraps the mutator in `sdk.runWithAuth(...)`
- `deleteCard(cardId, boardId)` dispatches a before-event whose payload includes the relevant card/board context
- `transferCard(...)` dispatches a before-event with the transfer-specific board and card hints
- `updateComment(...)` and `submitForm(...)` dispatch before-events that carry their operation-specific identifiers in `input`

The auth listener combines that scoped request auth with the event payload's actor/board hints before resolving identity and policy.

Important boundary:

- `BeforeEventPayload` contains `event`, `input`, `actor`, `boardId`, and `timestamp`
- it does **not** contain `auth`
- first-party auth listeners resolve auth from the scoped carrier, not from the payload

---

## Host token acquisition and auth context sources

Each host surface is responsible for creating `AuthContext`.

### Standalone HTTP API

Source file:

- `src/standalone/authUtils.ts`

Behavior:

- reads `Authorization: Bearer <token>`
- strips the `Bearer ` prefix
- wraps SDK mutators in `sdk.runWithAuth(extractAuthContext(req), fn)`
- produces:

```ts
{ token, tokenSource: 'request-header', transport: 'http' }
```

If no bearer token is present:

```ts
{ transport: 'http' }
```

### Standalone WebSocket

The standalone WebSocket path also extracts auth context from the upgrade request and threads that same context into WebSocket-triggered mutations.

That means browser-triggered socket actions and REST mutations use the same token source model and the same `runWithAuth(...)`-scoped execution path on the standalone server.

### CLI

Source file:

- `src/cli/index.ts`

Behavior:

- reads `--token <value>` first, then falls back to `process.env.KANBAN_LITE_TOKEN` and `process.env.KANBAN_TOKEN`
- wraps mutators in `sdk.runWithAuth(resolveCliAuthContext(), fn)`
- if `--token` is present, produces:

```ts
{ token, tokenSource: 'flag', transport: 'cli' }
```

- otherwise, when an env token is present, produces:

```ts
{ token, tokenSource: 'env', transport: 'cli' }
```

- otherwise:

```ts
{ transport: 'cli' }
```

The CLI also has an auth status command:

- `kl auth status`

### MCP server

Source file:

- `src/mcp-server/index.ts`

Behavior:

- reads `process.env.KANBAN_TOKEN`
- wraps mutators in `sdk.runWithAuth(resolveMcpAuthContext(), fn)`
- if present, produces:

```ts
{ token, tokenSource: 'env', transport: 'mcp' }
```

- otherwise:

```ts
{ transport: 'mcp' }
```

The MCP server exposes auth diagnostics via:

- `get_auth_status`

### VS Code extension host

Source files:

- `src/extension/auth.ts`
- `src/extension/index.ts`

Behavior:

- stores the token in VS Code `SecretStorage`
- secret key: `kanban-lite.authToken`
- wraps privileged mutations in `sdk.runWithAuth(await getAuthContext(), fn)`
- produces:

```ts
{ token, tokenSource: 'secret-storage', transport: 'extension' }
```

or, when no token is stored:

```ts
{ transport: 'extension' }
```

Extension commands:

- `Kanban Lite: Set Auth Token`
- `Kanban Lite: Clear Auth Token`

Important boundary:

- the token stays in the Node extension host
- raw token material is not supposed to flow into the webview bundle

---

## Diagnostics and status surfaces

There are two layers of auth diagnostics.

### SDK-level status

`sdk.getAuthStatus()` returns:

- `identityProvider`
- `policyProvider`
- `identityEnabled`
- `policyEnabled`

This tells you which provider ids are active and whether they are non-noop.

### Host-augmented status

Each host adds transport/token-source diagnostics on top of `sdk.getAuthStatus()`.

Typical extra fields are:

- `configured`
- `tokenPresent`
- `tokenSource`
- `transport`

These status surfaces do **not** reveal token contents or the RBAC principal registry. They report safe metadata only: provider ids, whether auth is configured, whether a token is currently present, and the token-source / transport labels.

### Standalone REST diagnostics

Endpoints:

- `GET /api/auth`
- `GET /api/workspace`

These expose safe auth metadata only.

### CLI diagnostics

Command:

- `kl auth status`

This prints:

- identity provider id
- policy provider id
- whether auth is configured
- whether a token is present
- token source label
- transport label

### MCP diagnostics

Tool:

- `get_auth_status`

### Extension diagnostics

The extension computes auth status in the host and passes safe metadata to the UI state for display/awareness.

---

## HTTP error mapping

The standalone auth utility maps `AuthError` categories to HTTP status codes.

Current mapping in `src/standalone/authUtils.ts`:

- `auth.identity.missing` → `401`
- `auth.identity.invalid` → `401`
- `auth.identity.expired` → `401`
- `auth.policy.denied` → `403`
- `auth.policy.unknown` → `403`
- everything else → `500`

That mapping is intentionally category-based rather than string-based.

---

## Security guarantees in the current design

The current implementation makes several explicit promises.

### 1. Tokens are host inputs, not workspace config

Tokens are acquired from:

- request headers,
- environment variables,
- or VS Code `SecretStorage`.

They are not stored in `.kanban.json`.

### 2. Tokens are write-only

Raw tokens are intended to be consumed for identity resolution and not re-exposed.

They should not appear in:

- REST responses,
- CLI output,
- MCP output,
- logs,
- denial messages,
- or webview messages.

### 3. The webview is not an auth plugin host

Auth plugins are for Node-hosted surfaces.

The webview does not execute auth logic directly.

### 4. Policy is centralized

The SDK is the only authoritative allow/deny layer.

This avoids parity drift between:

- standalone server,
- CLI,
- MCP,
- and extension host behavior.

---

## Reference examples

### Minimal open-access workspace

No auth config at all:

```json
{
	"version": 2,
	"defaultBoard": "default",
	"boards": {
		"default": {
			"name": "Default",
			"columns": [
				{ "id": "backlog", "name": "Backlog", "color": "#6b7280" }
			],
			"nextCardId": 1,
			"defaultStatus": "backlog",
			"defaultPriority": "medium"
		}
	},
	"kanbanDirectory": ".kanban",
	"defaultPriority": "medium",
	"defaultStatus": "backlog",
	"nextCardId": 1
}
```

Normalized auth result:

- `auth.identity = noop`
- `auth.policy = noop`

### Explicitly declaring noop auth

```json
{
	"auth": {
		"auth.identity": { "provider": "noop" },
		"auth.policy": { "provider": "noop" }
	}
}
```

This is functionally equivalent to omitting the `auth` block.

### Selecting the built-in starter RBAC provider pair

```json
{
	"auth": {
		"auth.identity": { "provider": "rbac" },
		"auth.policy": { "provider": "rbac" }
	}
}
```

This enables the built-in RBAC provider ids, but successful identity resolution still depends on runtime-owned principal data.

### Example runtime principal registry

```ts
const principals = new Map([
	['opaque-admin-abc', { subject: 'alice', roles: ['admin'] }],
	['opaque-mgr-xyz', { subject: 'bob', roles: ['manager'] }],
	['opaque-user-tok', { subject: 'carol', roles: ['user'] }],
])

const identityPlugin = createRbacIdentityPlugin(principals)
```

This helper-backed plugin validates tokens against runtime-owned data.

- unknown tokens resolve to `null`
- roles come from the registry entry
- token text is never parsed for role inference

### Example host token usage

Standalone REST:

```http
GET /api/auth HTTP/1.1
Authorization: Bearer <token>
```

CLI:

```sh
KANBAN_TOKEN=example-token kl auth status
```

MCP:

```sh
KANBAN_TOKEN=example-token kanban-mcp
```

---

## Limitations and non-goals

The following are not currently implemented as a completed shared feature set.

### No dynamic external auth provider loading yet

The current resolver supports two built-in auth provider ids:

- `noop`
- `rbac`

But it does **not** yet dynamically load arbitrary external auth providers.

Also, the exported `RBAC_IDENTITY_PLUGIN` singleton uses an empty registry by default, so a host/runtime must provide principal material through `createRbacIdentityPlugin(principals)` if it wants real token validation.

### No row/card filtering

Auth currently does not rewrite or filter list/query results.

If a protected action is denied, the system returns an error rather than silently filtering results.

### No browser login UX contract

There is no standardized shared login flow such as OAuth popup or browser-mediated refresh flow.

### No token refresh contract

Refresh behavior is not part of the shared auth contract.

### No universal host-side token precedence framework

Current host token handling exists and is normalized into `AuthContext`, but the full future story for multi-source precedence and richer auth UX is still intentionally limited.

---

## Relationship to storage capabilities

Auth capabilities are separate from storage capabilities.

Current storage capabilities:

- `card.storage`
- `attachment.storage`

Current auth capabilities:

- `auth.identity`
- `auth.policy`

They share the same broad configuration style and capability-resolution pattern, but they solve different problems:

- storage decides **where data lives**
- auth decides **who may perform protected actions**

---

## Where to look in the codebase

If you want the implementation source of truth, start here:

### Config and capability types

- `src/shared/config.ts`

### Auth plugin contracts and noop implementations

- `src/sdk/plugins/index.ts`

### Auth context, decisions, and errors

- `src/sdk/types.ts`

### SDK auth runtime and protected action hooks

- `src/sdk/KanbanSDK.ts`

### Standalone auth utilities

- `src/standalone/authUtils.ts`

### CLI auth adapter

- `src/cli/index.ts`

### MCP auth adapter

- `src/mcp-server/index.ts`

### VS Code extension auth adapter

- `src/extension/auth.ts`
- `src/extension/index.ts`

### Tests

- `src/sdk/__tests__/plugin-registry.test.ts`
- `src/sdk/__tests__/auth-enforcement.test.ts`
- `src/standalone/__tests__/server.integration.test.ts`

### Planning and architecture docs

- `docs/plan/20260320-auth-authz-plugin-architecture/architecture-decision-record.md`
- `docs/plan/20260320-auth-authz-plugin-architecture/architecture-requirements-stage-2.md`

---

## Final mental model

If you only remember five things, remember these:

1. Auth is split into **identity** and **policy** capabilities.
2. Both default to **noop**, so existing workspaces remain open unless auth is explicitly activated.
3. The SDK is the **only authoritative enforcement seam**.
4. Hosts supply tokens via `AuthContext`, but secrets do **not** belong in `.kanban.json`.
5. The current release ships `noop` plus a built-in starter `rbac` provider pair, but live RBAC identity resolution still depends on runtime-owned principal data rather than anything stored in `.kanban.json`.
