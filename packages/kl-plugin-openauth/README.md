# kl-plugin-openauth

A [kanban-lite](https://github.com/borgius/kanban-lite) auth plugin powered by [OpenAuth.js](https://openauth.js.org). It delegates all token management, PKCE flows, and subject verification to the OpenAuth client SDK instead of reimplementing OAuth.

## Capabilities

| Capability | Provider ID | Description |
|---|---|---|
| `auth.identity` | `openauth` | Resolves identity from an OpenAuth access token via `client.verify(subjects, token, { refresh })` |
| `auth.policy` | `openauth` | RBAC policy with user / manager / admin action matrix (same shape as `kl-plugin-auth`) |
| `standalone.http` | `openauth-http` | Middleware + routes for cookie-based browser sessions |

## Install

```bash
npm install kl-plugin-openauth
```

For local sibling-repo development a checkout at `../kl-plugin-openauth` is resolved automatically.

## Quick start

Point both auth capabilities at `openauth` and supply the OpenAuth issuer URL:

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "openauth",
      "options": {
        "issuer": "https://auth.example.com",
        "clientId": "my-kanban-app"
      }
    },
    "auth.policy": { "provider": "openauth" }
  }
}
```

Start the standalone server. Unauthenticated browser requests redirect to `/auth/openauth/login`; API requests receive `401`.

## How it works

### Authentication flow

1. An unauthenticated user visits the board. The middleware redirects to `/auth/openauth/login`.
2. The login page shows a "Sign in with OpenAuth" button linking to `/auth/openauth/authorize`.
3. The authorize route calls `client.authorize(redirectUri, "code", { pkce: true })` and stores the PKCE challenge in an HttpOnly cookie.
4. The user authenticates at the OpenAuth issuer (password form, social login, etc.).
5. The issuer redirects back to `/auth/openauth/callback?code=...`.
6. The callback route calls `client.exchange(code, redirectUri, verifier)` and stores the resulting access and refresh tokens as HttpOnly cookies (`oa_access_token`, `oa_refresh_token`).
7. On every subsequent request the middleware calls `client.verify(subjects, accessToken, { refresh: refreshToken })` which validates the JWT, checks the subject schema, and auto-refreshes expired tokens. Refreshed tokens are written back to cookies transparently.

### Identity resolution

The identity plugin reads the subject properties returned by `client.verify()`:

- `userID` (or `userId` / `id`) becomes the `identity.subject`.
- The role claim (configurable, default `role`) is read and mapped via `roleMapping` to produce `identity.roles`.

### Policy enforcement

The policy plugin uses the same three-tier RBAC matrix shipped by `kl-plugin-auth`:

| Role | Permitted actions |
|---|---|
| `user` | `form.submit`, `comment.*`, `attachment.*`, `card.action.trigger`, `log.add`, `card.checklist.*` |
| `manager` | All user actions plus `card.create`, `card.update`, `card.move`, `card.transfer`, `card.delete`, `board.action.trigger`, `log.clear`, `board.log.add` |
| `admin` | All manager actions plus board/config mutations: `settings.update`, `plugin-settings.*`, `webhook.*`, `label.*`, `column.*`, `storage.migrate`, and more |

Roles are cumulative upward. Anonymous callers (no identity) are always denied.

## Plugin options reference

### `auth.identity` options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `issuer` | `string` | **yes** | — | URL of the OpenAuth issuer server |
| `clientId` | `string` | **yes** | — | OAuth client ID registered at the issuer |
| `callbackPath` | `string` | no | `/auth/openauth/callback` | Path that receives the OAuth callback redirect |
| `roleMapping.claim` | `string` | no | `role` | Subject property name that carries the user's role |
| `roleMapping.default` | `string` | no | `user` | Fallback role when the claim is missing or empty |

#### Example — identity with custom role mapping

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "openauth",
      "options": {
        "issuer": "https://auth.example.com",
        "clientId": "my-kanban-app",
        "roleMapping": {
          "claim": "team_role",
          "default": "user"
        }
      }
    }
  }
}
```

If your OpenAuth subject carries `{ userID: "alice", team_role: "editor" }`, the identity plugin reads `team_role` as the role claim. Values that don't match a built-in role name are passed through as-is; combine with a custom permission matrix to grant them actions.

### `auth.policy` options

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `permissions` | `array` | no | built-in RBAC matrix | Custom permission matrix. Each entry maps one role to a list of allowed actions. |

Each entry in `permissions`:

| Field | Type | Description |
|---|---|---|
| `role` | `string` | Role name (must match a role from identity resolution) |
| `actions` | `string[]` | Actions this role is allowed to perform |

When `permissions` is omitted or empty, the built-in user/manager/admin matrix applies.

#### Example — custom permission matrix

```json
{
  "plugins": {
    "auth.policy": {
      "provider": "openauth",
      "options": {
        "permissions": [
          {
            "role": "viewer",
            "actions": ["comment.create", "attachment.add"]
          },
          {
            "role": "editor",
            "actions": [
              "card.create", "card.update", "card.move",
              "comment.create", "comment.update",
              "attachment.add", "attachment.remove"
            ]
          },
          {
            "role": "admin",
            "actions": [
              "card.create", "card.update", "card.move", "card.delete",
              "settings.update", "plugin-settings.read", "plugin-settings.update"
            ]
          }
        ]
      }
    }
  }
}
```

Custom entries are evaluated independently — there is no implicit inheritance. List every allowed action for each role explicitly.

## Standalone HTTP routes

When the standalone server loads this plugin, it registers the following routes and middleware:

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/openauth/login` | public | Login landing page with "Sign in with OpenAuth" button |
| `GET` | `/auth/openauth/authorize` | public | Starts the PKCE code flow via `client.authorize()` |
| `GET` | `/auth/openauth/callback` | public | Exchanges the authorization code via `client.exchange()` |
| `POST\|GET` | `/auth/openauth/logout` | any | Clears token cookies and redirects to login |

The middleware runs before all non-public routes. It:

- Reads `oa_access_token` and `oa_refresh_token` from cookies.
- Calls `client.verify(subjects, accessToken, { refresh })` to validate and optionally refresh.
- On success, sets auth context (`identity`, `roles`, `actorHint`) for downstream handlers.
- On failure, returns 401 (API) or redirects to login (pages).

### Login page query parameters

| Param | Description |
|---|---|
| `returnTo` | URL path to redirect to after successful login (default `/`) |
| `error` | Error message to display on the login page |

### Cookie details

| Cookie | HttpOnly | SameSite | Max-Age | Purpose |
|---|---|---|---|---|
| `oa_access_token` | yes | Lax | configurable (default 86400) | JWT access token |
| `oa_refresh_token` | yes | Lax | 31536000 (1 year) | Long-lived refresh token |
| `oa_pkce_challenge` | yes | Lax | 600 (10 min) | Temporary PKCE verifier + returnTo during auth flow |

## Subject schema

The plugin defines a default OpenAuth subject using [valibot](https://valibot.dev):

```ts
import { object, string, optional } from 'valibot'
import { createSubjects } from '@openauthjs/openauth/subject'

export const subjects = createSubjects({
  user: object({
    userID: string(),
    role: optional(string()),
  }),
})
```

The issuer must return a `user` subject with at least `userID`. The `role` field is optional and feeds into the role mapping pipeline.

## Embedded issuer (development)

For local development, the plugin exports `createEmbeddedIssuer()` which runs an in-process OpenAuth issuer with `PasswordProvider` and `MemoryStorage`. Pre-seeded users are stored in the issuer's memory storage at startup so they can log in immediately without a registration step.

**Never store plain-text passwords in `.kanban.json`.** Use the `kl openauth add-user` CLI command to generate a scrypt hash, then store the resulting `passwordHash` object:

```bash
kl openauth add-user --email admin@example.com --password s3cr3t --role admin
kl openauth add-user --email user@example.com --password p4ssw0rd --role user
```

The command updates `.kanban.json` in place, replacing any existing entry for that email:

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "openauth",
      "options": {
        "issuer": "http://localhost:2954",
        "clientId": "my-kanban-app",
        "embeddedIssuer": {
          "password": {
            "users": [
              {
                "email": "admin@example.com",
                "passwordHash": {
                  "hash": "<base64>",
                  "salt": "<base64>",
                  "N": 16384,
                  "r": 8,
                  "p": 1
                },
                "role": "admin"
              }
            ]
          }
        }
      }
    }
  }
}
```

You can also hash passwords programmatically:

```ts
import { hashPassword, isHashedPassword } from 'kl-plugin-openauth'

const hash = await hashPassword('s3cr3t')
// => { hash: '...', salt: '...', N: 16384, r: 8, p: 1 }

isHashedPassword(hash)   // true
isHashedPassword('s3cr3t') // false — plain text rejected

const issuer = createEmbeddedIssuer({
  password: {
    users: [
      { email: 'admin@example.com', passwordHash: hash, role: 'admin' },
    ],
  },
  theme: { primary: '#0070f3' },
  ttl: { access: 3600, refresh: 86400 },
  allowAllClients: true,
})

// Plug into a Node HTTP server:
// issuer.handleRequest(req, res, 'http://localhost:3000')
```

### `EmbeddedIssuerOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `password` | `boolean \| { users?: EmbeddedIssuerUser[] }` | — | Enable password login. Pass an object to pre-seed users. |
| `users` | `EmbeddedIssuerUser[]` | `[]` | Flat user list (legacy; prefer `password.users`) |
| `google` | `{ clientId: string; clientSecret: string }` | — | Google OAuth2 provider credentials |
| `theme` | `{ primary: string \| { light: string; dark: string } }` | — | OpenAuth UI theme |
| `ttl` | `{ access?: number; refresh?: number }` | OpenAuth defaults | Token TTL in seconds |
| `allowAllClients` | `boolean` | `true` | Whether to accept any `clientID` |
| `mountPath` | `string` | — | Reserved for future sub-path mounting |
| `select` | `Record<string, { display?: string; hide?: boolean }>` | — | OpenAuth `Select` provider configuration |

### `EmbeddedIssuerUser`

| Field | Type | Description |
|---|---|---|
| `email` | `string` | User's email address |
| `passwordHash` | `ScryptHasherResult` | Pre-hashed password. Use `hashPassword()` or `kl openauth add-user` to generate. |
| `password` | `string` | **Deprecated.** Plain-text password hashed at startup with a console warning. Migrate to `passwordHash`. |
| `role` | `string` | Optional role claim returned in the OpenAuth subject (`user`, `manager`, `admin`, or custom). |

### `kl openauth add-user`

```
kl openauth add-user --email <email> --password <password> [--role <role>]
```

| Flag | Required | Description |
|---|---|---|
| `--email` | yes | Email address for the user |
| `--password` | yes | Plain-text password to hash and store |
| `--role` | no | Role to assign (`user`, `manager`, `admin`, or custom) |

The command modifies `plugins["auth.identity"].options.embeddedIssuer.password.users` in `.kanban.json`. If an entry with the same email already exists it is updated in place; the plain-text password is never written to disk.

## Plugin settings UI

Both `auth.identity` and `auth.policy` export `optionsSchema()` and `uiSchema` metadata, so the shared Plugin Options workflow renders schema-driven forms:

- **Identity**: grouped fields for issuer URL, client ID, callback path, and role mapping.
- **Policy**: an array editor for the permission matrix with inline role + actions editing.

No secret fields are declared — tokens are ephemeral cookies, not stored in `.kanban.json`.

## Exports

```ts
// Default export: full plugin package object
import openAuthPlugin from 'kl-plugin-openauth'

// Named exports
import {
  // Plugin instances
  OPENAUTH_IDENTITY_PLUGIN,
  OPENAUTH_POLICY_PLUGIN,
  authIdentityPlugins,   // { openauth: OPENAUTH_IDENTITY_PLUGIN }
  authPolicyPlugins,     // { openauth: OPENAUTH_POLICY_PLUGIN }

  // Factories
  createAuthIdentityPlugin,
  createAuthPolicyPlugin,
  createStandaloneHttpPlugin,
  createEmbeddedIssuer,

  // Schema helpers
  optionsSchemas,
  policyOptionsSchemas,

  // Subject schema
  subjects,
} from 'kl-plugin-openauth'
```

## Development

```bash
pnpm --filter kl-plugin-openauth test        # 69 unit tests
pnpm --filter kl-plugin-openauth build       # Vite CJS bundle
pnpm --filter kl-plugin-openauth typecheck   # tsc --noEmit
```

The build bundles `@openauthjs/openauth` and `valibot` inline (both are ESM-only) so the output is a single CJS file compatible with the kanban-lite runtime.
