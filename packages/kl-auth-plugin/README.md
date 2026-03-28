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

- `auth.identity` → trusts host-validated standalone session identity, or the shared CLI / MCP API token supplied via `--token` (CLI only), `KANBAN_LITE_TOKEN`, or `KANBAN_TOKEN`
- `auth.policy` → allows any authenticated identity and denies anonymous callers
- `standalone.http` → serves `/auth/login`, handles login/logout, redirects unauthenticated standalone browser requests, and accepts cookie auth for standalone API calls

When `local` starts inside the standalone server and `KANBAN_LITE_TOKEN` is missing, it creates a `kl-...` token and persists it to `<workspaceRoot>/.env`.

## `.kanban.json` examples

Auth capabilities are declared in the `plugins` key alongside storage providers. Use the npm package name `kl-auth-plugin` as the provider value.

### RBAC

```json
{
  "plugins": {
    "auth.identity": { "provider": "kl-auth-plugin" },
    "auth.policy": { "provider": "kl-auth-plugin" }
  }
}
```

### Custom RBAC matrix

Provide `options.matrix` on `auth.policy` to override the default behaviour per role.  Each key is a role name and the value is the list of actions that role may perform.  Roles are **not** cumulative — list every action explicitly for each role.

```json
{
  "plugins": {
    "auth.identity": { "provider": "kl-auth-plugin" },
    "auth.policy": {
      "provider": "kl-auth-plugin",
      "options": {
        "matrix": {
          "user":    ["form.submit", "comment.create", "comment.update", "comment.delete", "attachment.add", "attachment.remove", "card.action.trigger", "log.add"],
          "manager": ["card.create", "card.update", "card.move", "card.transfer", "card.delete", "board.action.trigger", "log.clear", "board.log.add"],
          "admin":   ["board.create", "board.update", "board.delete", "settings.update", "webhook.create", "webhook.update", "webhook.delete", "label.set", "label.rename", "label.delete", "column.create", "column.update", "column.reorder", "column.setMinimized", "column.delete", "column.cleanup", "board.action.config.add", "board.action.config.remove", "board.log.clear", "board.setDefault", "storage.migrate", "card.purgeDeleted"]
        }
      }
    }
  }
}
```

### Local standalone login + API token

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "kl-auth-plugin",
      "options": {
        "users": [
          {
            "username": "alice",
            "password": "$2b$12$REPLACE_WITH_BCRYPT_HASH",
            "role": "user"
          }
        ]
      }
    },
    "auth.policy": { "provider": "kl-auth-plugin" }
  }
}
```

Use the `kl` CLI to add users without computing hashes manually:

```sh
kl auth create-user --username alice --password s3cr3t
kl auth create-user --username admin --password s3cr3t --role admin
```

The command bcrypt-hashes the password and appends the user to `plugins["auth.identity"].options.users` in `.kanban.json`.

### Explicit API token

By default, when the `local` standalone provider starts and `KANBAN_LITE_TOKEN` is not set, it generates a random token and writes it to `<workspaceRoot>/.env`. To pin a known token instead, set `options.apiToken` directly in `.kanban.json`:

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "kl-auth-plugin",
      "options": {
        "apiToken": "my-secret-token"
      }
    },
    "auth.policy": { "provider": "kl-auth-plugin" }
  }
}
```

The `apiToken` option takes precedence over the `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` environment variables for bearer-token authentication. When it is set the standalone server will not auto-generate or write a `.env` token.

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
