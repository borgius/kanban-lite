# kl-plugin-auth

A [kanban-lite](https://github.com/borgius/kanban-lite) auth plugin package that implements:

- `auth.identity`
- `auth.policy`
- optional standalone-only `standalone.http` middleware/routes for login flows
- listener-only auth runtime helpers for SDK-owned async before-events

The package currently ships three provider ids:

- `local`
- `noop`
- `rbac`

It also exports the package-name provider id `kl-plugin-auth` as a compatibility alias. The shared Plugin Options flow typically presents and persists the explicit provider ids above while showing `kl-plugin-auth` as the supplying package.

## Install

```bash
npm install kl-plugin-auth
```

## Capabilities

- `auth.identity`
- `auth.policy`
- `standalone.http` (optional, auto-loaded from active auth packages by the standalone server)

## Shared Plugin Options workflow and `optionsSchema()`

`kl-plugin-auth` participates in Kanban Lite's shared **Plugin Options** workflow used by the settings UI and the matching REST/CLI/MCP plugin-management surfaces.

- Install/discover the package as `kl-plugin-auth`.
- Select the auth provider id per capability (`local`, `rbac`, `noop`, or the compatibility alias `kl-plugin-auth`).
- The selected provider id is persisted in `.kanban.json` at `plugins["auth.identity"].provider` / `plugins["auth.policy"].provider`; there is no separate auth-enabled boolean.
- Both the exported package providers and the configurable factory helpers expose `optionsSchema()` metadata so the shared workflow can render schema-driven forms.

Current schema-backed fields:

- `auth.identity`: `apiToken`, `users[].username`, `users[].password`, `users[].role`
- `auth.policy`: `matrix`

Secret metadata is declared for:

- `apiToken`
- `users.*.password`

Those fields are treated as write-only masked secrets in shared read/list/error flows. Stored values reopen as `••••••`; leaving the mask unchanged keeps the stored value, while typing a new value replaces it. The shared workflow never redisplays the raw stored secret/hash.

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

Auth capabilities are declared in the `plugins` key alongside storage providers. Install the npm package `kl-plugin-auth`, then select one of the provider ids it exports (`local`, `rbac`, `noop`, or the compatibility alias `kl-plugin-auth`).

### RBAC

```json
{
  "plugins": {
    "auth.identity": { "provider": "rbac" },
    "auth.policy": { "provider": "rbac" }
  }
}
```

### Custom RBAC matrix

Provide `options.matrix` on `auth.policy` to override the default behaviour per role.  Each key is a role name and the value is the list of actions that role may perform.  Roles are **not** cumulative — list every action explicitly for each role.

```json
{
  "plugins": {
    "auth.identity": { "provider": "rbac" },
    "auth.policy": {
      "provider": "rbac",
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
      "provider": "local",
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
    "auth.policy": { "provider": "local" }
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
      "provider": "local",
      "options": {
        "apiToken": "my-secret-token"
      }
    },
    "auth.policy": { "provider": "local" }
  }
}
```

The `apiToken` option takes precedence over the `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` environment variables for bearer-token authentication. When it is set the standalone server will not auto-generate or write a `.env` token. In shared Plugin Options readbacks this field is masked as `••••••`; leaving that mask untouched keeps the existing stored token, while entering a new value replaces it.

## Local development / monorepo workflow

```bash
# From the repository root
pnpm --filter kl-plugin-auth build
pnpm --filter kl-plugin-auth test:integration

# Or from this package directory
npm install
npm run build
npm run test:integration
```

Inside this monorepo, Kanban Lite resolves `packages/kl-plugin-auth` directly. The legacy sibling checkout fallback at `../kl-plugin-auth` intentionally remains for temporary compatibility outside the monorepo, so `npm link ../kl-plugin-auth` is optional rather than the primary workflow.

## License

MIT
