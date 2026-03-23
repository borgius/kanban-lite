# kl-auth-plugin

A [kanban-lite](https://github.com/borgius/kanban-lite) auth plugin package that implements:

- `auth.identity`
- `auth.policy`
- optional standalone-only `standalone.http` middleware/routes for login flows
- listener-only auth runtime helpers for SDK-owned async before-events

The package currently ships three provider ids:

- `local`
- `noop`
- `rbac`

## Install

```bash
npm install kl-auth-plugin
```

## Capabilities

- `auth.identity`
- `auth.policy`
- `standalone.http` (optional, auto-loaded from active auth packages by the standalone server)

## Listener runtime helpers

The package also exports listener-only auth helpers for the SDK before-event pipeline:

- `createAuthListenerPlugin(identity, policy, options)`
- `createLocalAuthListenerPlugin(options?)`
- `createNoopAuthListenerPlugin(options?)`
- `createRbacAuthListenerPlugin(principals?, options?)`

These listeners register on SDK before-events, read request-scoped auth installed by host surfaces via `sdk.runWithAuth(...)`, emit `auth.allowed` / `auth.denied`, veto denied mutations by throwing `AuthError`, and can optionally return plain-object input overrides via `options.overrideInput`. Listener overrides are immutably deep-merged by `KanbanSDK._runBeforeEvent()`; `BeforeEventPayload` no longer carries `auth`, so listeners must not rely on `payload.auth`.

The runtime contract is listener-only: capability providers still resolve identity and policy, but mutation enforcement now happens through SDK-owned before-events rather than a direct runtime seam. User-visible denial behavior remains unchanged.

## Provider ids

### `noop`

- `auth.identity` → always resolves to `null`
- `auth.policy` → always returns `{ allowed: true }`

This preserves Kanban Lite's open-access behavior.

### `rbac`

- `auth.identity` → validates opaque tokens against a runtime-owned principal registry
- `auth.policy` → enforces the fixed `user` → `manager` → `admin` action matrix

### `local`

- `auth.identity` → trusts host-validated standalone session identity, or the shared `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` API token
- `auth.policy` → allows any authenticated identity and denies anonymous callers
- `standalone.http` → serves `/auth/login`, handles login/logout, redirects unauthenticated standalone browser requests, and accepts cookie auth for standalone API calls

When `local` starts inside the standalone server and `KANBAN_LITE_TOKEN` is missing, it creates a `kl-...` token and persists it to `<workspaceRoot>/.env`.

## `.kanban.json` examples

### RBAC

```json
{
  "auth": {
    "auth.identity": { "provider": "rbac" },
    "auth.policy": { "provider": "rbac" }
  }
}
```

### Local standalone login + API token

```json
{
  "auth": {
    "auth.identity": {
      "provider": "local",
      "options": {
        "users": [
          {
            "username": "alice",
            "password": "$2b$12$REPLACE_WITH_BCRYPT_HASH"
          }
        ]
      }
    },
    "auth.policy": { "provider": "local" }
  }
}
```

## Local development / monorepo workflow

```bash
# From the repository root
pnpm --filter kl-auth-plugin build
pnpm --filter kl-auth-plugin test:integration

# Or from this package directory
npm install
npm run build
npm run test:integration
```

Inside this monorepo, Kanban Lite resolves `packages/kl-auth-plugin` directly. The legacy sibling checkout fallback at `../kl-auth-plugin` intentionally remains for temporary compatibility outside the monorepo, so `npm link ../kl-auth-plugin` is optional rather than the primary workflow.

## License

MIT
