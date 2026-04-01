# Plugin System Deep Dive

This document explains the plugin system in depth: what problem it solves, how capability resolution works, how SDK-owned before/after events drive listener-only runtime plugins, how to select and change providers in `.kanban.json`, what the core and compatibility providers do, how attachment handling works, and how to author third-party plugins that work with the current runtime.

It is intentionally more detailed than the README. Think of this as the “how the machine is built” guide.

---

## What the plugin system is for

Kanban Lite used to treat storage as a simple engine switch (`markdown` vs `sqlite`). That worked for built-in storage backends, but it coupled too many assumptions together:

- where cards live,
- whether cards have local file paths,
- how attachments are copied and opened,
- what hosts should watch for refreshes,
- and how future providers should integrate.

The plugin system splits those concerns into **capabilities**.

Today the core capability namespaces are:

- `card.storage`
- `attachment.storage`
- `card.state`
- `webhook.delivery`
- `callback.runtime`
- `auth.identity`
- `auth.policy`
- `auth.visibility`

That means:

- one provider can store cards/comments,
- another provider can store attachments,
- card-state can stay actor-scoped without being mixed into shared card content,
- a webhook provider can own webhook CRUD while a paired listener handles outbound delivery,
- a callback provider can run trusted inline JavaScript or subprocess handlers for committed after-events through the shared plugin-settings flow,
- auth providers can resolve identity/policy while SDK-owned before-event listeners enforce the decision, and an opt-in visibility provider can filter card reads after identity resolution,
- or one provider can implement multiple capabilities explicitly in the plugin layer.

This is the foundation that allows core-owned built-ins like `markdown`, compatibility ids like `sqlite` / `mysql`, fully external npm packages, and listener-only runtime plugins to coexist behind one SDK-owned action pipeline.

---

## Mental model

The plugin system has five layers:

1. **Config normalization**
   - Reads legacy and modern config.
   - Produces a normalized capability map.

2. **Provider resolution**
  - Resolves the configured provider for each namespace.
  - Chooses built-in plugin modules or loads external npm packages.

3. **Resolved capability bag**
   - Produces one runtime object containing:
     - the active card storage engine,
     - the active attachment storage plugin,
     - the active runtime listener plugins,
     - provider metadata,
     - host hints like `isFileBacked` and `watchGlob`.

4. **SDK-owned action lifecycle**
   - `KanbanSDK` emits before-events before writes and after-events after commit.
   - Before-event listeners are awaited in registration order.
   - After-event listeners are non-blocking and error-isolated.

5. **SDK host usage**
   - `KanbanSDK`, the standalone server, the CLI, MCP, and the VS Code extension consume the resolved bag instead of hard-coding engine-specific behavior.

In short:

- config says **what** you want,
- the resolver decides **which providers to load**,
- the SDK owns **when before/after events happen**,
- and host layers use the result to decide **how to behave**.

The new extension model adds two more narrow seams on top of that same active-package discovery path:

- plugins may export `sdkExtensionPlugin` to contribute additive SDK methods discoverable via `sdk.getExtension(id)`,
- and plugins may export `mcpPlugin` to register MCP tools without creating a second plugin framework.

---

## Plugin settings workflow

The runtime model in this document now has a matching public management surface called **plugin settings**.

That workflow is exposed consistently through:

- the Settings panel's **Plugin Options** tab in standalone and VS Code (backed by the standalone websocket settings bridge in the web UI),
- the CLI's top-level `plugin-settings` command,
- the REST API's `/api/plugin-settings` routes,
- and the MCP tools `list_plugin_settings`, `select_plugin_settings_provider`, `update_plugin_settings_options`, and `install_plugin_settings_package`.

All of those surfaces delegate to the same SDK-owned contracts, so they share the same capability grouping, selected-provider semantics, redaction rules, guarded install behavior, and auth checks.

### Capability-grouped inventory and selected-provider semantics

Plugin settings inventory is grouped by full capability namespace rather than by flat package name.

Today that means the UI/API/CLI/MCP inventory can show providers for capabilities such as:

- `card.storage`
- `attachment.storage`
- `card.state`
- `callback.runtime`
- `auth.identity`
- `auth.policy`
- `auth.visibility`
- `webhook.delivery`

Each provider row includes:

- `providerId`
- `packageName`
- `discoverySource`
- whether it is currently selected for that capability
- optional schema metadata from `optionsSchema()`

Enablement is represented only by provider selection. The canonical persisted form is the provider reference under `plugins[capability]` in `.kanban.json`; there is no second enabled/disabled boolean. Legacy config aliases still normalize into the same selected-provider view, but plugin-settings mutations write the canonical `plugins[capability]` entry. In the settings UI this now appears as a per-provider on/off toggle with in-flight loading feedback instead of separate Activate/Active buttons.

Discovery sources surfaced to users are:

- `builtin`
- `workspace`
- `dependency`
- `global`
- `sibling`

Those labels come directly from the resolver, so they describe why a provider is available in the current runtime rather than guessing from package names.

### `optionsSchema()` and schema-driven configuration

Providers may expose an `optionsSchema()` hook. When present, the loader normalizes it into transport-safe schema metadata containing:

- `schema` — the JSON Schema used for editing
- optional `uiSchema` — JSON Forms UI hints
- `secrets` — secret-field metadata used for masking and write-only behavior

The **Plugin Options** tab uses that metadata to render provider options through the shared JSON Forms stack rather than hard-coded provider-specific forms. Schema-backed providers render their options form in dedicated sections after the capability list instead of nesting the form inside the capability row, even when that provider is not currently selected.

Schema and field `description` values are surfaced as visible helper text in the shared Plugin Options form, so provider authors should treat those descriptions as user-facing setup guidance rather than transport-only metadata.

Saving options for an inactive provider does not change enablement. Instead, the shared contract caches those values under `pluginOptions[capability][providerId]` in `.kanban.json`. When that provider is selected later, the cached options are restored into the canonical `plugins[capability]` entry automatically.

The shared plugin-settings loader resolves provider metadata before transport. `optionsSchema()` may therefore return a plain metadata object, a promise, or nested sync/async value resolvers inside `schema` / `uiSchema` fields, as long as the final resolved result is transport-safe JSON Forms metadata. This is useful for runtime-derived enums such as event/action catalogs.

For anything more complex than a few flat scalar fields — especially arrays, nested objects, or sections that benefit from inline detail editors — providers should ship an explicit `uiSchema` instead of relying on the generated one-control-per-property fallback. Prefer JSON Forms `Group` / `VerticalLayout` / `HorizontalLayout`, array `options.detail`, `elementLabelProp`, and targeted `rule` conditions so the shared settings UI gets stable labels and predictable editing behavior.

When a field such as `enum`, `default`, or a JSON Forms `rule` depends on runtime data, providers should prefer nested sync/async resolvers in `schema` / `uiSchema` values instead of UI-only schema extensions. The shared loader resolves those functions before transport, so hosts still receive plain JSON-compatible metadata.

JSON Schema `default` values are also applied when the shared settings editor opens provider options that omit a field, so providers can seed editable arrays such as auth role catalogs without hard-coding that behavior in the UI layer.

When a provider is selected and there are still no saved options for it, the same schema-default pass is now persisted into `plugins[capability].options`. For example, selecting `auth.policy: rbac` or `auth.policy: kl-plugin-auth` writes the default permission rows derived from the shipped `RBAC_ROLE_MATRIX` instead of leaving the provider selected with an empty options object. Selected providers with an existing but empty options object are also backfilled during plugin-settings refresh so the config and form stay aligned after reloads.

The first-party `kl-plugin-callback` package uses this path directly: `plugins["callback.runtime"].options.handlers` is one ordered mixed array, and its explicit `uiSchema` switches the shared JSON Forms detail editor between the CodeMirror-backed inline `source` field and the process `command` / `args` / `cwd` fields.

If a provider does not expose `optionsSchema()`, it can still be selected, but the settings UI correctly reports that the provider does not expose schema-driven options.

### Redacted read/list behavior

Plugin settings read/list flows are safe to surface to authorized callers because redaction happens in the SDK contract, not only in the UI.

- Inventory/list responses expose capability rows, selected-provider state, package names, discovery sources, and optional schema metadata.
- Provider read/update responses use the shared redacted read model.
- Persisted secrets are never re-read in plain text.
- `plugin-settings.read` authorizes inventory/list/detail reads before any inventory or provider payload is materialized.
- `plugin-settings.update` authorizes selected-provider changes, option updates, and guarded installs.

Secret fields declared through `optionsSchema().secrets` reopen as masked write-only placeholders (`••••••`). The public behavior is:

- read/list/detail surfaces show the masked placeholder instead of the stored secret,
- leaving that masked value unchanged during an update preserves the current stored secret,
- entering a new value replaces the stored secret,
- and surfaced errors reuse the same redaction policy instead of echoing raw option payloads.

The settings panel hosts, standalone websocket bridge, REST routes, CLI commands, and MCP tools reuse those same SDK checks. MCP currently exposes `plugin-settings.read` through `list_plugin_settings`, while its mutation tools use `plugin-settings.update`.

This is why CLI output, REST responses, MCP results, and host/webview messages can all reuse the same payload shapes safely. Redaction does not replace authorization; it only limits what an allowed caller can see.

---

## Capability namespaces

### `card.storage`

This capability owns card/comment persistence.

A `card.storage` provider is responsible for returning a `StorageEngine` implementation.

Core built-in provider:

- `markdown`

Compatibility provider ids resolved through external packages:

- `sqlite`
- `mysql`
- `postgresql`
- `mongodb`
- `redis`

This capability owns attachment copy/materialization behavior.

Built-in provider:

- `localfs`

The `attachment.storage` capability does **not** currently replace all card-storage behavior. It specifically covers things like:

- where attachments live,
- how attachments are copied,
- whether a host can materialize a safe local file path for an attachment.

### `webhook.delivery`

This capability owns webhook registry CRUD.

Compatibility/default provider id:

- `webhooks`

External package:

- `kl-plugin-webhook`

Behavior:

- persists webhook definitions in the existing `.kanban.json` top-level `webhooks` array,
- pairs with a listener-only runtime subscriber that delivers matching committed SDK after-events via HTTP POST,
- preserves the existing payload envelope and HMAC signing behavior,
- keeps the registry format stable so existing workspaces do not need migration.

Important config nuance: unlike storage capabilities, webhook delivery is currently configured under the top-level `webhookPlugin` key rather than the `plugins` map.

---

### `callback.runtime`

This capability owns same-runtime callback automation for committed SDK after-events.

Provider id:

- `callbacks`

External package:

- `kl-plugin-callback`

Behavior:

- is selected through the shared plugin-settings path at `plugins["callback.runtime"]`,
- persists one ordered mixed `plugins["callback.runtime"].options.handlers` array,
- supports `inline` rows evaluated with `new Function` and invoked as `({ event, sdk })`,
- supports `process` rows that receive one serialized `{ event }` JSON payload on stdin only,
- logs per-handler failures and continues later matching handlers.

Trust model:

- inline handlers are trusted same-runtime JavaScript, not sandboxed, and run with host process privileges,
- process handlers are ordinary subprocesses, not sandboxed, and do not receive a live SDK object or other in-memory runtime handles.

Inline source authoring stays inside the shared plugin-settings workflow, but now uses the embedded CodeMirror JavaScript editor rather than a plain multiline text field.

---

### `auth.identity`

This capability resolves a raw token to a typed identity.

Compatibility/default provider ids:

- `noop` (default) — always returns `null` (anonymous); preserves current open-access behavior.
- `rbac` — validates opaque tokens against a runtime-owned principal registry and returns `{ subject, roles, groups? }` for registered principals.
- `local` — trusts host-validated standalone session identity, or the shared `KANBAN_LITE_TOKEN` / `KANBAN_TOKEN` API token for CLI, MCP, and bearer-authenticated HTTP calls.

External package:

- `kl-plugin-auth`

Important nuance: the exported `RBAC_IDENTITY_PLUGIN` singleton is backed by an empty registry, so hosts that want live token validation must construct a runtime-backed plugin via `createRbacIdentityPlugin(principals)` and wire it in through custom capability wiring. Unknown or absent tokens resolve to `null`, and roles are never inferred from token text.

### `auth.policy`

This capability decides whether an identity may perform a named action.

Compatibility/default provider ids:

- `noop` (default) — always returns `true` (allow-all); preserves current open-access behavior.
- `rbac` — enforces the fixed SDK-owned `RBAC_ROLE_MATRIX` for the cumulative `user`, `manager`, and `admin` roles.
- `local` — requires a non-null identity and otherwise allows the action unless a custom permission matrix is configured.

External package:

- `kl-plugin-auth`

The built-in `rbac` policy denies `null` identity with `auth.identity.missing`, denies uncovered actions with `auth.policy.denied`, and returns the resolved caller subject as `actor` on allow.

Both `local` and `rbac` policy providers now support an editable `options.permissions` array in shared plugin-settings flows. The shared Plugin Options UI treats that matrix as role-based: each row picks a role from the `auth.identity` role catalog via `permissions[].role` and lists the allowed auth actions for that role. The picker starts from the SDK before-event catalog and supplements it with `plugin-settings.read` and `plugin-settings.update`. Existing legacy `options.matrix` role maps are still honored at runtime for backward compatibility.

### `auth.visibility`

This capability filters the visible subset of an already-loaded card set.

Compatibility/default provider id:

- `none` (default) — disabled; card reads remain unfiltered.

External package:

- `kl-plugin-auth-visibility`

Behavior:

- is selected through the shared plugin-settings path at `plugins["auth.visibility"]`,
- consumes the SDK-resolved identity and normalized role list; it does **not** resolve tokens, sessions, or roles itself,
- matches rules by roles only,
- unions cards granted by multiple matching rules,
- applies **AND** semantics across different fields and **OR** semantics within one field,
- supports `@me` for assignee matching,
- returns no visible cards when the caller matches no rules,
- gives no implicit admin/manager bypass.

The canonical runtime seam lives in `src/sdk/modules/cards.ts`, where the SDK filters list/get flows before host surfaces consume them. Hidden cards therefore behave as ordinary not-found or no-match results in REST, CLI, MCP, and UI flows that already resolve cards through the SDK.

> **Note:** Auth capability enforcement now runs through SDK-owned before-events on the privileged async mutation surface used by the Node-hosted adapters, plus direct SDK checks for `plugin-settings.read` / `plugin-settings.update` on the shared plugin-settings workflows. The shipped `noop` / `rbac` / `local` ids resolve through `kl-plugin-auth` when present, with a compatibility provider fallback retained so existing workspaces and test environments do not break when the package has not been installed yet. Active plugin packages may also contribute standalone-only HTTP middleware and routes (for example the `local` provider's `/auth/login` flow) without a separate config namespace.

---

## Config model

The canonical config lives in `.kanban.json`.

For plugin settings flows, the canonical persistence model is one selected provider per capability under `plugins[capability]`. That same config entry may also carry the selected provider's persisted `options` payload.

Inactive providers may also have cached options stored separately under `pluginOptions[capability][providerId]` so hosts can reopen and save schema-driven forms without changing the selected provider.

Example:

```json
{
  "plugins": {
    "auth.identity": {
      "provider": "local",
      "options": {
        "roles": ["operator", "reviewer", "admin"],
        "apiToken": "stored-secret",
        "users": [
          {
            "username": "alice",
            "password": "$2b$12$REPLACE_WITH_BCRYPT_HASH",
            "role": "admin"
          }
        ]
      }
    }
  },
  "pluginOptions": {
    "auth.identity": {
      "rbac": {
        "roles": ["operator", "reviewer", "admin"]
      }
    }
  }
}
```

The plugin-settings model does not add a second `enabled` boolean. Switching providers means changing the selected provider reference for that capability.

`auth.visibility` uses the same explicit disabled form, and runtime normalization resolves the capability to `{ provider: "none" }` when it is omitted so existing workspaces do not start filtering cards accidentally.

For `webhook.delivery`, plugin settings also support an explicit disabled state by persisting:

```json
{
  "plugins": {
    "webhook.delivery": {
      "provider": "none"
    }
  }
}
```

That disables webhook runtime loading without discarding any previously stored provider options, so the same webhook configuration can be restored when the provider is re-enabled.

Webhook delivery uses its own top-level config section:

```json
{
  "webhookPlugin": {
    "webhook.delivery": {
      "provider": "webhooks"
    }
  }
}
```

If `webhookPlugin` is omitted, runtime normalization still defaults to `{ provider: "webhooks" }` for `webhook.delivery`. That default resolves to the external `kl-plugin-webhook` package; when the package is not installed, webhook CRUD methods fail with a deterministic install error instead of falling back to a built-in runtime path.

First-party callback runtime selection uses the normal shared plugin-settings path:

```json
{
  "plugins": {
    "callback.runtime": {
      "provider": "callbacks",
      "options": {
        "handlers": [
          {
            "name": "log task creation",
            "type": "inline",
            "events": ["task.created"],
            "enabled": true,
            "source": "async ({ event, sdk }) => { console.log(event.event, sdk.constructor.name) }"
          },
          {
            "name": "notify local worker",
            "type": "process",
            "events": ["task.created", "task.updated"],
            "enabled": true,
            "command": "node",
            "args": ["scripts/callback-worker.mjs"],
            "cwd": "."
          }
        ]
      }
    }
  }
}
```

That `handlers[]` list is intentionally mixed: inline rows carry `source`; process rows carry `command` / `args` / `cwd`.

Only provider selection lives in `.kanban.json`. Listener plugins are runtime-loaded by the SDK; there is no separate user-facing `event.listener` config namespace.

## Runtime listener model

Runtime plugins are now **listener-only**.

- `KanbanSDK` owns before/after event timing for mutations.
- Before-events are awaited in listener-registration order.
- `KanbanSDK._runBeforeEvent()` clones the original input, preserves it when no listener changes it, and immutably deep-merges plain-object listener overrides in registration order (arrays replace; they do not concatenate).
- Throwing from a before-event listener aborts the write before any mutation happens.
- After-events fire exactly once after commit and stay non-blocking so side effects cannot break the caller.

For auth specifically, first-party listeners resolve request-scoped auth from `sdk.runWithAuth(...)` plus the payload's actor/board hints. `BeforeEventPayload` no longer includes an `auth` field, so plugin authors should not expect `payload.auth` to exist.

The runtime listener contract is `SDKEventListenerPlugin`:

```ts
interface SDKEventListenerPlugin {
  manifest: { id: string; provides: readonly string[] }
  register(bus: EventBus): void
  unregister(): void
}
```

This replaces the old `init(...)` / `destroy()` runtime seam for plugin authors. Storage and attachment providers remain direct capability adapters; they do not participate in this listener contract.

First-party `kl-plugin-webhook` and `kl-plugin-callback` both use this listener-only model; users configure `webhook.delivery` or `callback.runtime`, not the internal `event.listener` seam.

### Modern capability-based config

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite",
      "options": {
        "sqlitePath": ".kanban/kanban.db"
      }
    },
    "attachment.storage": {
      "provider": "localfs"
    }
  }
}
```

Each capability namespace maps to a `ProviderRef`:

```ts
interface ProviderRef {
  provider: string
  options?: Record<string, unknown>
}
```

### Legacy compatibility config

Legacy fields still work:

```json
{
  "storageEngine": "sqlite",
  "sqlitePath": ".kanban/kanban.db"
}
```

These are normalized internally into capability selections.

### Precedence rules

The normalization rules are explicit and stable:

1. `plugins[namespace]`
2. legacy `storageEngine` / `sqlitePath` for `card.storage`
3. defaults:
  - `card.storage` → `localfs`
   - `attachment.storage` → `localfs`

So if you have both forms present:

```json
{
  "storageEngine": "sqlite",
  "plugins": {
    "card.storage": { "provider": "localfs" }
  }
}
```

then `card.storage` resolves to `localfs`.

### What normalization returns

Internally, config normalization produces a complete `ResolvedCapabilities` map:

```ts
type ResolvedCapabilities = Record<
  'card.storage' | 'attachment.storage',
  ProviderRef
>
```

Even if you omit one namespace in config, the normalized map always includes both.

---

## Core and compatibility providers

## `localfs` (legacy `markdown` alias)

Namespace: `card.storage`

Behavior:

- stores cards as markdown files under `.kanban/boards/...`
- is file-backed
- exposes local card file paths
- reports `watchGlob: "boards/**/*.md"`

Host implications:

- the standalone server and VS Code extension can watch local files,
- cards can be opened directly in the editor,
- local attachment directory resolution works naturally.

## `sqlite`

Namespace: `card.storage`

Behavior:

- stores cards/comments in a SQLite database,
- is **not** file-backed for cards,
- does not expose local card file paths,
- reports `watchGlob: null`.

Attachments:

- attachments still default to `localfs`,
- attachment files are stored on disk,
- card/comment persistence is separate from attachment persistence.

External package:

The `sqlite` provider id is a compatibility alias for the `kl-plugin-storage-sqlite` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-plugin-storage-sqlite
```

The package exports both `cardStoragePlugin` and `attachmentStoragePlugin`.

## `mysql`

Namespace: `card.storage`

Behavior:

- stores cards/comments in MySQL tables,
- is **not** file-backed for cards,
- does not expose local card file paths,
- reports `watchGlob: null`.

Requirements:

- `database` is required in provider options,
- the `mysql2` driver is loaded lazily,
- environments that do not use MySQL do not need `mysql2` installed.

External package:

The `mysql` provider id is a compatibility alias for the `kl-plugin-storage-mysql` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-plugin-storage-mysql
```

The package exports both `cardStoragePlugin` and `attachmentStoragePlugin`, and preserves the lazy `mysql2` load semantics.

## `postgresql`

Namespace: `card.storage`

Behavior:

- stores cards/comments in PostgreSQL tables,
- is **not** file-backed for cards,
- does not expose local card file paths,
- reports `watchGlob: null`.

Requirements:

- `database` is required in provider options,
- the `pg` driver is loaded lazily,
- environments that do not use PostgreSQL do not need `pg` installed.

External package:

The `postgresql` provider id is a compatibility alias for the `kl-plugin-storage-postgresql` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-plugin-storage-postgresql
```

The package exports both `cardStoragePlugin` and `attachmentStoragePlugin`, and preserves the lazy `pg` load semantics.

## `mongodb`

Namespace: `card.storage`

Behavior:

- stores cards/comments in MongoDB collections,
- is **not** file-backed for cards,
- does not expose local card file paths,
- reports `watchGlob: null`.

Requirements:

- `database` is required in provider options,
- the `mongodb` driver is loaded lazily,
- environments that do not use MongoDB do not need `mongodb` installed.

External package:

The `mongodb` provider id is a compatibility alias for the `kl-plugin-storage-mongodb` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-plugin-storage-mongodb
```

The package exports both `cardStoragePlugin` and `attachmentStoragePlugin`, and preserves the lazy `mongodb` load semantics.

## `redis`

Namespace: `card.storage`

Behavior:

- stores cards/comments in Redis hashes,
- is **not** file-backed for cards,
- does not expose local card file paths,
- reports `watchGlob: null`.

Requirements:

- the `ioredis` driver is loaded lazily,
- environments that do not use Redis do not need `ioredis` installed.

External package:

The `redis` provider id is a compatibility alias for the `kl-plugin-storage-redis` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-plugin-storage-redis
```

The package exports both `cardStoragePlugin` and `attachmentStoragePlugin`, and preserves the lazy `ioredis` load semantics.

## `card.state` (auto-derived from storage)

Namespace: `card.state`

Card-state is now **automatically derived** from the active `card.storage` plugin.
There is no need to install or configure a separate `card.state` package.

Behavior:

- When `card.storage` is `localfs` (default), the built-in file-backed backend persists actor-scoped unread/open state in workspace sidecar files,
- When `card.storage` is an external plugin (e.g. `sqlite`, `mongodb`, `postgresql`, `mysql`, `redis`), card-state is loaded from the same storage package via its `createCardStateProvider` export,
- Plugin Settings reuses the selected `card.storage` provider/options for storage-backed `card.state` rows instead of surfacing a second database configuration form,
- If the storage package does not export card-state support, the built-in file-backed backend is used as a fallback,
- persisted `card.state` data is distinct from `.active-card.json` and other active-card UI selection state,
- all backends share the same SDK-owned unread derivation, explicit read/open mutations, and stable auth-absent default actor contract.

Identity behavior:

- when no real `auth.identity` provider is configured, callers use the shared default actor contract,
- when a real `auth.identity` provider is configured but no actor can be resolved, host surfaces report `identity-unavailable` / `ERR_CARD_STATE_IDENTITY_UNAVAILABLE`,
- this is intentionally different from backend unavailability (`unavailable` / `ERR_CARD_STATE_UNAVAILABLE`).

No separate installation is needed — card-state support is included in each storage plugin:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite"
    }
  }
}
```

The above configuration automatically provides both card storage and card-state via the `kl-plugin-storage-sqlite` package.

> **Deprecation notice:** The dedicated `kl-plugin-card-state-sqlite`, `kl-plugin-card-state-mongodb`, and `kl-plugin-card-state-redis` packages are deprecated. Explicit `card.state` configuration is still supported for backward compatibility but is no longer required.

Example with explicit options:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "host": "localhost",
        "port": 3306,
        "user": "kanban",
        "password": "secret",
        "database": "kanban_db"
      }
    }
  }
}
```

Runtime failure mode when the driver is missing:

- clear error message,
- actionable install hint,
- no hidden hard dependency for users who never select MySQL.

## `localfs`

Namespace: `attachment.storage`

Behavior:

- copies attachments to a local directory,
- can resolve a card attachment directory,
- can materialize a local file path for safe serving/opening.

`localfs` is implemented as an explicit built-in attachment plugin in the plugin layer.

That means:

- with core `markdown`, `localfs` delegates directly to the markdown engine,
- with external card providers that expose the same local attachment semantics, `localfs` delegates to the active engine,
- omitted or redundant matching `attachment.storage` config is normalized to the active `card.storage` provider/options for first-party storage plugins,
- when `attachment.storage` would otherwise stay on `localfs`, the resolver still gives the selected external card provider package a same-package chance to provide `attachment.storage` first.

---

## Resolver architecture

The central resolver is `resolveCapabilityBag(...)` in `src/sdk/plugins/index.ts`.

It takes:

- a fully normalized capability map,
- the absolute `.kanban` directory path.

It returns a `ResolvedCapabilityBag` containing:

- `cardStorage`
- `attachmentStorage`
- `providers`
- `isFileBacked`
- `getLocalCardPath(...)`
- `getAttachmentDir(...)`
- `materializeAttachment(...)`
- `getWatchGlob()`

### Why this bag exists

Without the bag, each host would need to know too much:

- “If markdown, watch `.md` files”
- “If sqlite, don’t watch anything”
- “If mysql, don’t open native files”
- “If attachments are local, serve from disk”

That logic used to leak into host code.

Now the hosts ask the bag instead:

- `isFileBacked`
- `getWatchGlob()`
- `getLocalCardPath(card)`
- `materializeAttachment(card, name)`

This keeps plugin-specific knowledge in the plugin layer.

---

## Card storage plugin interface

The runtime contract for a `card.storage` provider is shape-based.

Current interface:

```ts
interface CardStoragePlugin {
  manifest: PluginManifest
  createEngine(kanbanDir: string, options?: Record<string, unknown>): StorageEngine
  nodeCapabilities?: {
    isFileBacked: boolean
    getLocalCardPath(card: Card): string | null
    getWatchGlob(): string | null
  }
}
```

### `manifest`

The manifest declares:

- `id`: provider id
- `provides`: array of capability namespaces

Example:

```ts
manifest: {
  id: 'my-provider',
  provides: ['card.storage']
}
```

### `createEngine(...)`

This must return a `StorageEngine`.

That engine is the actual persistence backend consumed by `KanbanSDK`.

### `nodeCapabilities`

These are optional but important.

They tell node-hosted consumers:

- whether cards are file-backed,
- whether they have local paths,
- which file glob to watch for refreshes.

If your provider does not store cards as local files, return:

```ts
nodeCapabilities: {
  isFileBacked: false,
  getLocalCardPath() { return null },
  getWatchGlob() { return null }
}
```

If your provider is file-backed, this metadata should be accurate. Host behavior depends on it.

---

## Attachment storage plugin interface

Current runtime contract:

```ts
interface AttachmentStoragePlugin {
  manifest: PluginManifest
  getCardDir?(card: Card): string | null
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  appendAttachment?(
    card: Card,
    attachment: string,
    content: string | Uint8Array
  ): Promise<boolean>
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}
```

### `copyAttachment(...)`

Required.

This is how the SDK moves a source file into the provider-owned attachment location.

### `appendAttachment(...)`

Optional.

Use this when your backend can append efficiently to an existing attachment without rewriting the whole object.

Current intended use case:

- card log attachments such as `<cardId>.log`

Contract:

- return `true` when the provider handled the append in-place
- return `false` when the provider cannot do native append and the runtime should fall back to a normal read/modify/write update via `copyAttachment(...)`

Examples:

- S3 directory buckets / S3 Express One Zone can use `PutObject` with `WriteOffsetBytes`
- standard S3 buckets or MinIO may not support native append, so returning `false` is correct and expected

### `getCardDir(...)`

Optional, but useful when your attachment storage is directory-based and local.

### `materializeAttachment(...)`

Optional, but highly recommended when attachment access is not a trivial directory lookup.

Use this when:

- files are stored outside the standard `.kanban` tree,
- you need to map attachment names to provider-owned files,
- you want to enforce validation or temporary file materialization.

If `materializeAttachment(...)` is not implemented, the runtime falls back to building a path from `getCardDir(...)`.

### Card logs and attachment providers

Card logs are stored as the attachment file `<cardId>.log`.

That means log behavior now follows the active `attachment.storage` provider:

- file-backed providers usually store the log file in a local attachment directory
- remote providers can materialize the log file temporarily through `materializeAttachment(...)`
- append-capable providers may accelerate repeated log writes through `appendAttachment(...)`
- providers without native append support still work through the runtime fallback path

---

## Package-level plugin manifest

Every first-party plugin package exports a `pluginManifest` constant that
declares all capabilities and integration surfaces the package provides.

The engine reads this manifest first for fast, reliable discovery instead of
duck-typing individual exports.

### Shape

```ts
export const pluginManifest = {
  id: 'kl-plugin-storage-sqlite',
  capabilities: {
    'card.storage': ['sqlite'] as const,
    'attachment.storage': ['sqlite'] as const,
    'card.state': ['sqlite'] as const,
  },
} as const
```

The fields:

| Field            | Type                                                        | Required | Description |
|------------------|-------------------------------------------------------------|----------|-------------|
| `id`             | `string`                                                    | yes      | npm package name |
| `capabilities`   | `Partial<Record<PluginCapabilityNamespace, string[]>>`      | yes      | Provider IDs offered per capability namespace |
| `integrations`   | `('standalone.http'\|'cli'\|'mcp.tools'\|'sdk.extension'\|'event.listener')[]` | no | Additional integration surfaces the package contributes |

### Discovery flow

1. The engine checks for `mod.pluginManifest` and validates its structure.
2. If found, it iterates only declared capabilities and resolves exports accordingly.
3. Structural validators (`isValidCardStoragePluginCandidate`, etc.) still run on the resolved exports.
4. If `pluginManifest` is absent, the engine falls back to exhaustive duck-typing probing for third-party compatibility.

### Type

The `KLPluginPackageManifest` interface and `PluginIntegrationNamespace` type are
exported from `kanban-lite/sdk` for plugin authors who want compile-time
validation.

Plugin packages should also import the shared public contracts from
`kanban-lite/sdk` instead of re-declaring local structural copies. That
includes provider contracts such as `CardStoragePlugin`,
`AttachmentStoragePlugin`, `WebhookProviderPlugin`, standalone and CLI
integration types, MCP tool registration types, auth plugin contracts, and the
plugin-settings schema metadata types.

---

## Plugin manifest validation

Validation is intentionally simple.

The loader checks:

- that the plugin object exists,
- that required methods exist,
- that `manifest.id` is a string,
- that `manifest.provides` includes the expected namespace.

For external plugins this means runtime validation is **shape-based**, not class-based.

That is convenient, but it also means plugin authors must match the current expected object shape exactly.

---

## External plugin loading

External providers are loaded lazily via `createRequire(...)`.

Important consequences:

- the host environment must be able to resolve the npm package,
- plugin loading happens in node-hosted contexts,
- missing packages produce explicit install hints,
- invalid exports produce explicit validation errors.

### Where the package must be installed

Install the plugin in the environment that is actually running Kanban Lite:

- CLI runtime
- standalone server runtime
- MCP server runtime
- VS Code extension host runtime
- SDK consumer environment

The resolver checks these locations in order and uses the first match:

1. `{workspaceRoot}/packages/{name}` — monorepo-local package (dev/staging only)
2. Local `node_modules` — standard `npm install` / pnpm workspace symlink
3. Global `node_modules` — `npm install -g {name}` (useful for CLI/MCP server use-cases)
4. Sibling directory `../{name}` — legacy non-monorepo checkout layout

If the package is not found in any of these locations, the resolver throws an actionable install hint.

These same locations also explain the plugin-settings install scopes:

- **`workspace` install** runs `npm install --ignore-scripts <package>` in the current workspace root. Use this for standalone servers, extension-hosted workspaces, or repo-local development where the runtime resolves packages from the workspace.
- **`global` install** runs `npm install --global --ignore-scripts <package>`. Use this primarily for globally installed CLI or MCP runtimes that resolve providers from global `node_modules`.

The in-product installer is intentionally narrow. It accepts only exact unscoped `kl-*` package names and rejects version specifiers, scoped names, URLs, paths, whitespace-delimited extra arguments, and shell fragments before any subprocess is launched. The SDK constructs fixed `npm` argv arrays with `shell: false`, always disables lifecycle scripts, and redacts surfaced stdout/stderr.

If a package depends on lifecycle scripts or a custom install flow, install it manually outside the in-product workflow.

### Export shapes supported today

For a card storage plugin, the loader accepts either:

- named export `cardStoragePlugin`
- default export containing the plugin object

For an attachment storage plugin, the loader accepts either:

- named export `attachmentStoragePlugin`
- default export containing the plugin object

For a webhook package, the loader accepts:

- named export `webhookProviderPlugin` (or a compatible default export) for CRUD capability ownership
- named export `webhookListenerPlugin` for listener-only runtime delivery
- named export `sdkExtensionPlugin` for additive SDK methods surfaced through `sdk.getExtension(id)`
- named export `mcpPlugin` for MCP tool registration through the narrow `registerTools(ctx)` seam

---

## SDK extension packs and compatibility shims

Plugins can now contribute additive SDK methods without modifying `KanbanSDK` directly.

The contract is intentionally small:

- the package exports `sdkExtensionPlugin`,
- the loader includes it in the resolved capability bag when that package is active,
- `KanbanSDK.getExtension(id)` returns the contributed extension bag.

`sdkExtensionPlugin` may also include an optional `events` array so plugins can declare additional discoverable SDK event names. Each declaration is metadata-only and has the shape `{ event, phase }`, where `phase` is either `before` or `after`. Plugins may also include optional `resource`, `label`, and `apiAfter` metadata on those declarations.

That catalog feeds the shared event-discovery surfaces:

- `sdk.listAvailableEvents({ type?, mask? })`
- CLI `kl events --type <before|after|all> --mask <pattern>`
- standalone `GET /api/events?type=...&mask=...`
- MCP `list_available_events`

Masks follow the same dotted wildcard rules as the EventEmitter2-backed SDK event bus, so patterns such as `task.*` and `comment.**` behave consistently across discovery and subscription.

Webhook migration is the first concrete use of this model.

- `kl-plugin-webhook` contributes the canonical webhook CRUD implementation through its SDK extension bag,
- advanced SDK consumers can call `sdk.getExtension('kl-plugin-webhook')`,
- and the long-lived `sdk.listWebhooks()`, `sdk.createWebhook()`, `sdk.updateWebhook()`, and `sdk.deleteWebhook()` methods remain compatibility shims so existing callers do not need to migrate immediately.

The same public-SDK rule now applies to plugin host contexts that expose an `sdk` value.

- CLI plugins receive the resolved public `KanbanSDK` instance when `context.sdk` is present.
- Standalone HTTP plugin registration and request contexts may expose that same public SDK instance.
- MCP tool contexts likewise expose the resolved public SDK instance.

That means plugin code can reuse the same public methods core surfaces call — for example `sdk.getBoard(...)`, `sdk.getExtension(...)`, `sdk.runWithAuth(...)` where available on the host seam, and `sdk.getConfigSnapshot()` for config reads — instead of rebuilding helper facades or reading `.kanban.json` directly for equivalent read paths.

`sdk.getConfigSnapshot()` returns a cloned read-only snapshot of the current workspace config. Treat it as inspection-only state: mutating the returned object does not update persisted config or the live SDK instance.

Recommended authoring rule:

- prefer public SDK methods first,
- then use `sdk.getConfigSnapshot()` for read-only config inspection when no narrower method exists,
- and keep direct plugin-owned writes only when the public SDK still has no equivalent write API.

This keeps core as the public compatibility seam while letting plugin packages own new capabilities incrementally.

---

## MCP tool registration seam

MCP now follows the same active-package discovery model used by standalone HTTP and CLI plugin loading.

The flow is deliberately narrow:

1. `collectActiveExternalPackageNames(...)` determines the canonical active package set.
2. `resolveMcpPlugins(...)` probes those packages for an optional `mcpPlugin` export.
3. The MCP server calls `registerTools(ctx)` once per plugin and registers the returned tool definitions.

Webhook tools are the first migrated toolset on this seam.

- `kl-plugin-webhook` registers `list_webhooks`, `add_webhook`, `update_webhook`, and `remove_webhook`,
- the public tool names and schemas stay unchanged,
- and core still supplies the shared auth/error context so behavior such as secret redaction and auth mapping remains stable.

### Error behavior

Missing plugin package:

- `Card storage plugin "x" is not installed. Run: npm install x`
- `Attachment storage plugin "x" is not installed. Run: npm install x`

Invalid plugin export:

- explicit error describing the missing export shape or capability mismatch

This is deliberate: plugin errors should be operator-friendly, not stack-trace archaeology.

---

## Compatibility aliases

The short provider ids `sqlite`, `mysql`, `postgresql`, `mongodb`, and `redis` are compatibility aliases. They allow existing
`.kanban.json` configurations to continue using the familiar short names while implementation
ownership moves to standalone, versioned npm packages.

| Provider id   | Install target                  |
| ------------- | ------------------------------- |
| `sqlite`      | `kl-plugin-storage-sqlite`      |
| `mysql`       | `kl-plugin-storage-mysql`       |
| `postgresql`  | `kl-plugin-storage-postgresql`  |
| `mongodb`     | `kl-plugin-storage-mongodb`     |
| `redis`       | `kl-plugin-storage-redis`       |

The alias map lives in `PROVIDER_ALIASES` in `src/sdk/plugins/index.ts` and is exported so
downstream tasks and tests can reference it directly.

Resolution rules:

1. If a core built-in implementation is registered for the provider id, use it.
2. Otherwise, look up the provider id in `PROVIDER_ALIASES` and load that package.
3. If there is no alias, treat the provider id as-is (bare npm package name).

This means install errors for `sqlite` and `mysql` always name `kl-plugin-storage-sqlite` and
`kl-plugin-storage-mysql`, not the short alias.

Both packages must export:

- `cardStoragePlugin` — implements the `CardStoragePlugin` interface
- `attachmentStoragePlugin` — implements the `AttachmentStoragePlugin` interface

CJS entry: `dist/index.cjs`

---

## Test ownership

Core (`kanban-light`) retains host-contract coverage. Provider packages own provider internals.

**Core keeps:**

- Plugin capability normalization and alias resolution tests
- Same-package attachment fallback behavior tests
- Migration/config cleanup behavior (using the externally loaded provider path)
- Manifest shape validation and actionable-error assertions
- Auth capability default tests

**Provider packages own:**

- CRUD/schema tests for their storage engine
- Live-database integration tests
- Schema migration correctness
- Provider-specific attachment behavior

This boundary prevents core from owning provider internals while keeping host observable
behavior verifiable without a running database.

---

## CJS vs ESM considerations

The runtime currently loads external plugins through `createRequire(...)`.

That means the safest packaging strategy for third-party plugins is:

- CommonJS, or
- dual-package output with a CommonJS-compatible entry.

If you ship a pure ESM-only plugin with no require-compatible entry, it may not load in the current resolver path.

For maximum compatibility, publish with one of these patterns:

- `dist/index.cjs`
- dual `exports` with a `require` target

Example `package.json` sketch:

```json
{
  "name": "kanban-s3-attachments",
  "main": "dist/index.cjs",
  "exports": {
    ".": {
      "require": "./dist/index.cjs",
      "default": "./dist/index.cjs"
    }
  }
}
```

---

## Attachment fallback rules

Attachment resolution has explicit fallback behavior.

### Precedence

When resolving attachments, the runtime uses this order:

1. explicit `attachment.storage` provider if it is non-`localfs`
2. same-package attachment plugin attempt when:
   - `attachment.storage` is `localfs`, and
   - `card.storage` is an external provider
3. built-in `localfs` attachment plugin

### Why the “same-package attachment plugin attempt” exists

If you install an external card provider and leave `attachment.storage` at its default `localfs`, the resolver gives that same provider package a chance to also export an attachment plugin.

If it does not, the resolver falls back to the built-in `localfs` attachment plugin.

This makes it possible for one external package to support both capabilities without requiring users to configure both namespaces separately.

### Example

```json
{
  "plugins": {
    "card.storage": {
      "provider": "kanban-acme-storage"
    }
  }
}
```

In this case:

- `card.storage` resolves to `kanban-acme-storage`
- `attachment.storage` defaults to `localfs`
- resolver tries to load `attachmentStoragePlugin` from `kanban-acme-storage`
- if not found, it falls back to the built-in `localfs` attachment plugin

---

## Host-facing behavior

The plugin system changes how hosts decide what they can do.

## File-backed vs non-file-backed

The most important host flag is:

- `isFileBacked`

If `true`:

- the host may watch files,
- native file editors may be used,
- direct local paths may exist.

If `false`:

- don’t assume a card file exists,
- use temp/materialization flows where supported,
- don’t set up file watchers unless a watch glob is explicitly provided.

## Watcher behavior

The host uses:

- `getWatchGlob()`

Examples:

- `markdown` → `boards/**/*.md`
- `sqlite` → `null`
- `mysql` → `null`

That means a provider can be file-backed **without** the host inferring the watched file type from provider name. The provider declares it.

## Local card paths

The host uses:

- `getLocalCardPath(card)`

Instead of reading `card.filePath` directly.

This is essential for non-file-backed providers because `card.filePath` is not a stable cross-provider contract anymore.

## Local attachment paths

The host uses:

- `getAttachmentDir(card)`
- `materializeAttachment(card, attachment)`

This allows providers to:

- use local attachment directories,
- use provider-owned locations outside the normal tree,
- deny path materialization safely,
- or generate temp files when needed.

---

## SDK integration points

The plugin system is centralized in `KanbanSDK`.

### Constructor flow

The constructor does the following when no prebuilt storage engine is injected:

1. resolves the workspace config,
2. normalizes storage capabilities,
3. applies SDK option overrides,
4. resolves the capability bag,
5. stores:
   - `_storage = bag.cardStorage`
   - `_capabilities = bag`

### SDK options

The SDK still supports older and newer override styles.

#### Legacy-style constructor override

```ts
const sdk = new KanbanSDK('.kanban', {
  storageEngine: 'sqlite',
  sqlitePath: '.kanban/kanban.db'
})
```

#### Capability-based override

```ts
const sdk = new KanbanSDK('.kanban', {
  capabilities: {
    'card.storage': {
      provider: 'mysql',
      options: {
        database: 'kanban_db'
      }
    }
  }
})
```

#### Fully injected engine

```ts
const sdk = new KanbanSDK('.kanban', {
  storage: myCustomEngine
})
```

If `storage` is injected directly:

- `sdk.capabilities` is `null`
- provider metadata is unavailable
- you are bypassing plugin resolution on purpose

That is still supported, but it is a lower-level escape hatch.

---

## Storage status and diagnostics

The SDK exposes `getStorageStatus()` to make provider behavior inspectable.

Current output shape:

```ts
{
  storageEngine: string,
  providers: ResolvedCapabilities | null,
  isFileBacked: boolean,
  watchGlob: string | null
}
```

This is the source used by:

- CLI storage status
- standalone `/api/storage`
- standalone `/api/workspace`
- MCP storage/workspace info
- extension/standalone host watcher decisions

When debugging a provider issue, this is your first checkpoint.

---

## Source of truth in the codebase

There is no longer a parallel `src/sdk/storage` implementation layer.

The plugin layer is now the real home of the remaining core providers:

- `src/sdk/plugins/markdown.ts`
- `src/sdk/plugins/localfs.ts`
- `src/sdk/plugins/index.ts`
- `src/sdk/plugins/types.ts`

That means:

- the remaining core engine class lives under `src/sdk/plugins/*`
- the remaining core attachment provider lives under `src/sdk/plugins/*`
- the registry resolves explicit providers from plugin-owned factories
- there is no separate storage factory path to keep in sync

If you are reading the code to understand how storage works, start in
`src/sdk/plugins/index.ts`, not in an old storage folder.

## MySQL compatibility alias deep dive

Core no longer owns a first-party MySQL implementation. The provider id `mysql` is a compatibility alias for the external package `kl-plugin-storage-mysql`.

### What it does

- implements `StorageEngine`
- stores cards in `kanban_cards`
- stores comments in `kanban_comments`
- keeps board/settings/config state in `.kanban.json`
- keeps attachments on local filesystem

### What it does not do

- it does not store attachments in MySQL,
- it does not claim file-backed card behavior,
- it does not require `mysql2` unless actually selected.

### Why the driver is lazy

Bundling MySQL as a hard dependency would penalize all users.

Instead:

- the provider id stays stable in `.kanban.json`,
- the package is loaded externally at runtime,
- the external package only loads `mysql2/promise` when the engine is created/initialized.

### Schema notes

The external MySQL engine stores core card fields directly in relational columns and serializes flexible fields like:

- `labels`
- `attachments`
- `metadata`
- `actions`

as JSON text.

This mirrors the SQLite package strategy in spirit, but uses MySQL tables and lazy pool management.

---

## How to switch providers

## Switch from markdown to sqlite

```json
{
  "plugins": {
    "card.storage": {
      "provider": "sqlite",
      "options": {
        "sqlitePath": ".kanban/kanban.db"
      }
    }
  }
}
```

Or keep using legacy compatibility fields:

```json
{
  "storageEngine": "sqlite",
  "sqlitePath": ".kanban/kanban.db"
}
```

## Switch from sqlite to mysql

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "host": "localhost",
        "user": "kanban",
        "password": "secret",
        "database": "kanban_db"
      }
    },
    "attachment.storage": {
      "provider": "localfs"
    }
  }
}
```

## Add a dedicated attachment provider

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "database": "kanban_db"
      }
    },
    "attachment.storage": {
      "provider": "kanban-s3-attachments",
      "options": {
        "bucket": "my-kanban-bucket"
      }
    }
  }
}
```

## Revert to defaults

Remove `plugins` and legacy storage overrides entirely.

Resolved defaults become:

- `card.storage` → `markdown`
- `attachment.storage` → `localfs`

---

## How to author a third-party card storage plugin

At runtime, Kanban Lite validates by object shape. That means your package does not need to extend a base class, but it **must** export the correct object shape.

### Minimal card storage plugin example

```ts
import type { Card } from 'kanban-lite/dist-types-or-local-copy'

class AcmeStorageEngine {
  type = 'kanban-acme-storage'
  kanbanDir

  constructor(kanbanDir, options = {}) {
    this.kanbanDir = kanbanDir
    this.options = options
  }

  async init() {}
  close() {}
  async migrate() {}
  async ensureBoardDirs() {}
  async deleteBoardData(_boardDir, _boardId) {}
  async scanCards(_boardDir, _boardId) { return [] }
  async writeCard(_card) {}
  async moveCard(_card, _boardDir, _newStatus) { return '' }
  async renameCard(_card, _newFilename) { return '' }
  async deleteCard(_card) {}
  getCardDir(card) { return `/tmp/${card.id}` }
  async copyAttachment(_sourcePath, _card) {}
}

export const cardStoragePlugin = {
  manifest: {
    id: 'kanban-acme-storage',
    provides: ['card.storage']
  },
  createEngine(kanbanDir, options) {
    return new AcmeStorageEngine(kanbanDir, options)
  },
  nodeCapabilities: {
    isFileBacked: false,
    getLocalCardPath() {
      return null
    },
    getWatchGlob() {
      return null
    }
  }
}
```

### Implementation guidance

If your storage is remote:

- set `isFileBacked: false`
- return `null` for `getLocalCardPath`
- return `null` for `getWatchGlob`

If your storage writes local files:

- set `isFileBacked: true`
- return real card file paths
- return the correct watch glob

### Important note on public typing

Today, plugin interfaces are documented in source and enforced at runtime by shape, but they are **not yet exported as a polished public plugin-author SDK surface** from `src/sdk/index.ts`.

So for now, plugin authors should treat this document plus the runtime shape checks as the source of truth.

In other words:

- the contract is real,
- the contract is validated,
- but the public “plugin author package API” is still lightweight.

---

## How to author a third-party attachment plugin

### Minimal attachment plugin example

```ts
import * as path from 'node:path'
import * as fs from 'node:fs/promises'

export const attachmentStoragePlugin = {
  manifest: {
    id: 'kanban-acme-attachments',
    provides: ['attachment.storage']
  },

  getCardDir(card) {
    return path.join('/var/lib/kanban-attachments', card.boardId ?? 'default', card.id)
  },

  async copyAttachment(sourcePath, card) {
    const dir = this.getCardDir(card)
    await fs.mkdir(dir, { recursive: true })
    await fs.copyFile(sourcePath, path.join(dir, path.basename(sourcePath)))
  },

  async appendAttachment(_card, _attachment, _content) {
    // optional optimization for append-heavy files like card logs
    return false
  },

  async materializeAttachment(card, attachment) {
    const dir = this.getCardDir(card)
    return path.join(dir, attachment)
  }
}
```

### When to implement `materializeAttachment(...)`

Implement it when:

- attachment files are not stored in a predictable directory,
- you need validation before returning a path,
- you may download/create a temp file first,
- or `getCardDir(...)` is not sufficient.

### When to implement `appendAttachment(...)`

Implement it when your backend supports efficient native append semantics for an existing object or blob.

Good candidates:

- append-only object APIs
- storage backends with server-side append or offset-write support

If your backend only supports overwrite, omit the hook or return `false` so the runtime can safely fall back.

### Security recommendation

Always validate the requested attachment name.

The built-in resolver logic is careful about rejecting unsafe path shapes like nested traversal. Third-party plugins should preserve that spirit.

---

## One-package multi-capability plugins

A provider package may support:

- only `card.storage`
- only `attachment.storage`
- or both

A practical pattern is to export both:

```ts
export const cardStoragePlugin = { ... }
export const attachmentStoragePlugin = { ... }
```

This works especially well when:

- one package owns both remote card persistence and remote attachment persistence,
- or you want users to configure only the card provider and rely on automatic same-package attachment discovery when `attachment.storage` is left as `localfs`.

---

## What “attach/change plugins” means in practice

There are three common operations users perform.

## 1. Select a provider

Set the capability in `.kanban.json`.

Example:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "kanban-acme-storage"
    }
  }
}
```

## 2. Change provider options

Keep the same provider id and edit `options`.

Example:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "mysql",
      "options": {
        "host": "db.internal",
        "port": 3306,
        "user": "kanban",
        "password": "secret",
        "database": "kanban_prod"
      }
    }
  }
}
```

## 3. Swap providers entirely

Replace the `provider` string (and usually `options`).

Example:

```json
{
  "plugins": {
    "card.storage": {
      "provider": "markdown"
    },
    "attachment.storage": {
      "provider": "localfs"
    }
  }
}
```

When doing this in a real workspace, remember:

- changing config changes future runtime resolution,
- it does **not** automatically migrate old data between arbitrary providers,
- only markdown ↔ sqlite compatibility helpers are currently exposed as migration commands.

---

## Current migration story

Current migration commands are compatibility helpers for the built-in-markdown / compatibility-sqlite flow:

- markdown → sqlite
- sqlite → markdown

These helpers do **not** currently provide generic plugin-to-plugin migration.

So if you:

- switch from `markdown` to `mysql`, or
- switch to a completely external provider,

then you should treat provider change and data migration as separate concerns unless your provider includes its own import path.

---

## Current limitations

This is important for plugin authors and operators.

### Capability namespaces are still intentionally small

Supported now:

- `card.storage`
- `attachment.storage`
- `card.state`
- `webhook.delivery`
- `callback.runtime`
- `auth.identity`
- `auth.policy`

More namespaces are possible, but the current public surface is still intentionally focused on storage, listener-based automation, and auth.

### Public plugin-author API is still runtime-shape-oriented

The system is real and tested, but plugin authoring currently relies on:

- documented object shape,
- runtime validation,
- current source structure.

There is not yet a polished exported “plugin SDK package” with stable helper factories.

### Generic migration is not yet public

Only built-in compatibility migrations are first-class.

### External plugin loading is node-host only

The webview does not load plugins directly.

### Pure ESM-only external plugins may be problematic

Because the loader uses `createRequire(...)`, require-compatible packaging is the safest route.

---

## Troubleshooting

## “Plugin is not installed”

Meaning:

- Node could not resolve the npm package in the current runtime environment.

Fix:

- install the package in the environment running Kanban Lite.

## “Plugin does not export a valid cardStoragePlugin”

Meaning:

- the package loaded, but the expected export shape was wrong.

Fix:

- export either `cardStoragePlugin` or a default object with:
  - `manifest`
  - `createEngine(...)`
- ensure `manifest.provides` includes `card.storage`

## “Plugin does not export a valid attachmentStoragePlugin”

Meaning:

- the package loaded, but the attachment plugin shape was wrong.

Fix:

- export either `attachmentStoragePlugin` or a default object with:
  - `manifest`
  - `copyAttachment(...)`
  - optional `appendAttachment(...)`
  - and either `getCardDir(...)` or `materializeAttachment(...)`
- ensure `manifest.provides` includes `attachment.storage`

## “MySQL storage requires the mysql2 driver”

Meaning:

- you selected the `mysql` compatibility provider id without installing `kl-plugin-storage-mysql`, or
- `kl-plugin-storage-mysql` is present but its peer driver `mysql2` is missing.

Fix:

```bash
npm install kl-plugin-storage-mysql mysql2
```

## Watchers don’t refresh

Check `getStorageStatus()` output:

- `isFileBacked`
- `watchGlob`

If `watchGlob` is `null`, the provider is saying the host should not rely on filesystem watching.

If your provider is file-backed and refreshes matter, implement `nodeCapabilities.getWatchGlob()` correctly.

## Editor/open-file flows don’t work

Check whether your provider returns:

- `isFileBacked: true`
- a real `getLocalCardPath(...)`

If not, hosts will correctly avoid assuming a card file exists.

---

## Practical recommendations for plugin authors

If you are building a plugin today, follow these rules:

1. **Keep the provider id stable.**
   - That id becomes the config contract.

2. **Be explicit about node capabilities.**
   - Especially `isFileBacked` and `watchGlob`.

3. **Ship require-compatible packaging.**
   - CommonJS or dual package is safest.

4. **Return actionable errors.**
   - Missing credentials, missing database names, etc.

5. **Treat attachment paths carefully.**
   - Never assume a user-provided attachment name is safe.

6. **Document your provider-specific `options`.**
   - The core runtime treats them as opaque.

7. **If you support both cards and attachments, export both plugin objects.**
   - That makes same-package resolution much smoother.

8. **Import public contracts from `kanban-lite/sdk`.**
  - Do not maintain private copies of shared SDK interfaces inside plugin packages.

---

## Quick reference

## Core and compatibility providers

| Namespace | Provider | File-backed | Watch glob | Notes |
|---|---|---:|---|---|
| `card.storage` | `localfs` | yes | `boards/**/*.md` | Default card provider (markdown engine) |
| `card.storage` | `sqlite` | no | `null` | Compatibility id backed by `kl-plugin-storage-sqlite` |
| `card.storage` | `mysql` | no | `null` | Compatibility id backed by `kl-plugin-storage-mysql` |
| `card.state` | _(auto)_ | — | `null` | Auto-derived from active `card.storage` plugin; falls back to built-in file-backed provider |
| `attachment.storage` | `localfs` | n/a | n/a | Default attachment provider |

## Resolver precedence

### Capability config precedence

1. `plugins[namespace]`
2. legacy `storageEngine` / `sqlitePath` for `card.storage`
3. defaults

### Attachment resolution precedence

1. explicit external `attachment.storage`
2. same-package attachment plugin attempt for external card providers when attachment provider is `localfs`
3. built-in `localfs` attachment plugin

---

## Summary

The plugin system is not just a new config shape. It is a shift from “engine name drives everything” to “capability contracts drive runtime behavior.”

That gives Kanban Lite:

- built-in provider flexibility,
- external provider support,
- correct host behavior for local vs remote storage,
- cleaner attachment handling,
- clearer diagnostics,
- and a path to future capabilities without re-hardcoding the world.

If you are only selecting providers, you mostly care about:

- `.kanban.json`
- precedence rules
- install/runtime requirements

If you are authoring providers, you care about:

- manifest shape
- plugin export names
- `StorageEngine` behavior
- node capability hints
- attachment materialization and safety

That split is exactly the point: simple to use, but structured enough to extend without chaos.
