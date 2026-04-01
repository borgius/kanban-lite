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
- Those schema-driven auth forms stay editable even while a provider is toggled off; inactive-provider saves are cached under `pluginOptions[capability][providerId]` and restored automatically when that provider is selected again.
- Those auth option forms now ship explicit JSON Forms `uiSchema` layouts, including grouped sections plus inline array-item detail editors for local users and permission rules.

Current schema-backed fields:

- `auth.identity`: `apiToken`, `roles[]`, `users[].username`, `users[].password`, `users[].role`
- `auth.policy`: `permissions[]`

The shared Plugin Options editor seeds `roles[]` with the default catalog `user`, `manager`, `admin` when the field is missing, still lets users add or delete extra entries like a normal array, and turns each `users[].role` field into a picker sourced from that live role catalog instead of a hard-coded enum.

The shared Plugin Options UI also treats `auth.policy.permissions[]` as a role-based matrix: each row picks a role from the same live `roles[]` catalog via `permissions[].role`, and `actions[]` is rendered as an action picker built from `sdk.listAvailableEvents({ type: 'before' })` plus auth-only supplements such as `plugin-settings.read` and `plugin-settings.update` when an SDK runtime is available. Without an SDK runtime, the picker falls back to the built-in before-event catalog plus the same auth-specific action supplements.

When users select `auth.policy: rbac` or `auth.policy: kl-plugin-auth` through the shared Plugin Options workflow and no saved policy options exist yet, the provider now seeds `options.permissions` from the canonical `RBAC_ROLE_MATRIX` so the editable config starts from the shipped role/action matrix instead of an empty array. The same backfill also runs on plugin-settings refresh when a selected auth-policy provider still has an empty options object.

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

The runtime contract is listener-only: capability providers still resolve identity and policy, SDK-owned before-events continue to drive listener hooks, and auth-only actions such as `plugin-settings.read` / `plugin-settings.update` are checked directly by the SDK without inventing synthetic events. User-visible denial behavior remains unchanged.

## Provider ids

### `noop`

- `auth.identity` → always resolves to `null`
- `auth.policy` → always returns `{ allowed: true }`

This preserves Kanban Lite's open-access behavior.

### `rbac`

- `auth.identity` → validates opaque tokens against a runtime-owned principal registry
- `auth.policy` → enforces the fixed `user` → `manager` → `admin` action matrix unless a custom permission matrix is configured

In the default RBAC matrix, `admin` includes both `plugin-settings.read` and `plugin-settings.update`; `user` and `manager` do not receive either action unless you add them explicitly in `options.permissions`.

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

### Custom permission matrix

Provide `options.permissions` on `auth.policy` to override the default behaviour per role. In the shared Plugin Options UI, each row picks one role from `auth.identity.options.roles` and lists the actions that role may perform. That action list combines the live before-event catalog with auth-only supplements such as `plugin-settings.read` and `plugin-settings.update`. These entries are evaluated independently — there is no implicit inheritance inside the custom matrix, so list every allowed action explicitly.

If you select the RBAC policy provider or the package-backed `kl-plugin-auth` policy provider first and have not saved custom options yet, Kanban Lite writes that default matrix into `.kanban.json` automatically so you can edit it in place.

```json
{
  "plugins": {
    "auth.identity": { "provider": "rbac" },
    "auth.policy": {
      "provider": "rbac",
      "options": {
        "permissions": [
          {
            "role": "manager",
            "actions": ["plugin-settings.read"]
          },
          {
            "role": "admin",
            "actions": [
              "plugin-settings.read",
              "plugin-settings.update",
              "settings.update",
              "board.delete"
            ]
          }
        ]
      }
    }
  }
}
```

Legacy role-map `options.matrix` objects remain supported at runtime for existing workspaces.

### Local standalone login + API token

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "local",
      "options": {
        "roles": ["operator", "reviewer", "admin"],
        "users": [
          {
            "username": "alice",
            "password": "$2b$12$REPLACE_WITH_BCRYPT_HASH",
            "role": "operator"
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
kl auth create-user --username admin --password s3cr3t --role reviewer
```

The command bcrypt-hashes the password, appends the user to `plugins["auth.identity"].options.users`, seeds the default `user` / `manager` / `admin` role catalog when missing, and adds the requested role to `plugins["auth.identity"].options.roles` when needed.

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
