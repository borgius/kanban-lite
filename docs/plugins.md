# Plugin System Deep Dive

This document explains the storage plugin system in depth: what problem it solves, how capability resolution works, how to select and change providers in `.kanban.json`, what the core and compatibility providers do, how attachment handling works, and how to author third-party plugins that work with the current runtime.

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

Today there are two **storage** capability namespaces:

- `card.storage`
- `attachment.storage`

And two **auth** capability namespaces (no-op by default):

- `auth.identity`
- `auth.policy`

That means:

- one provider can store cards/comments,
- another provider can store attachments,
- or one provider can implement both capabilities explicitly in the plugin layer.

This is the foundation that allows core-owned built-ins like `markdown`, compatibility ids like `sqlite` / `mysql`, and fully external npm packages to coexist behind the same capability contract.

---

## Mental model

The plugin system has four layers:

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
     - provider metadata,
     - host hints like `isFileBacked` and `watchGlob`.

4. **SDK host usage**
   - `KanbanSDK`, the standalone server, the CLI, MCP, and the VS Code extension consume the resolved bag instead of hard-coding engine-specific behavior.

In short:

- config says **what** you want,
- the resolver decides **which providers to load**,
- the SDK uses the result to decide **how to behave**.

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

### `attachment.storage`

This capability owns attachment copy/materialization behavior.

Built-in provider:

- `localfs`

The `attachment.storage` capability does **not** currently replace all card-storage behavior. It specifically covers things like:

- where attachments live,
- how attachments are copied,
- whether a host can materialize a safe local file path for an attachment.

---

### `auth.identity`

This capability resolves a raw token to a typed identity.

Built-in provider:

- `noop` (default) — always returns `null` (anonymous); preserves current open-access behavior.
- `rbac` — validates opaque tokens against a runtime-owned principal registry and returns `{ subject, roles }` for registered principals.

Important nuance: the exported `RBAC_IDENTITY_PLUGIN` singleton is backed by an empty registry, so hosts that want live token validation must construct a runtime-backed plugin via `createRbacIdentityPlugin(principals)` and wire it in through custom capability wiring. Unknown or absent tokens resolve to `null`, and roles are never inferred from token text.

### `auth.policy`

This capability decides whether an identity may perform a named action.

Built-in provider:

- `noop` (default) — always returns `true` (allow-all); preserves current open-access behavior.
- `rbac` — enforces the fixed SDK-owned `RBAC_ROLE_MATRIX` for the cumulative `user`, `manager`, and `admin` roles.

The built-in `rbac` policy denies `null` identity with `auth.identity.missing`, denies uncovered actions with `auth.policy.denied`, and returns the resolved caller subject as `actor` on allow.

> **Note:** Auth capability enforcement is live today at the SDK pre-action seam for the privileged async mutation surface used by the Node-hosted adapters. However, arbitrary external auth plugin loading and turnkey host-managed principal registries are still future work.

---

## Config model

The canonical config lives in `.kanban.json`.

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
   - `card.storage` → `markdown`
   - `attachment.storage` → `localfs`

So if you have both forms present:

```json
{
  "storageEngine": "sqlite",
  "plugins": {
    "card.storage": { "provider": "markdown" }
  }
}
```

then `card.storage` resolves to `markdown`.

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

## `markdown`

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

The `sqlite` provider id is a compatibility alias for the `kl-sqlite-storage` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-sqlite-storage
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

The `mysql` provider id is a compatibility alias for the `kl-mysql-storage` npm package. Install the external package in the host environment that loads Kanban Lite:

```sh
npm install kl-mysql-storage
```

The package exports both `cardStoragePlugin` and `attachmentStoragePlugin`, and preserves the lazy `mysql2` load semantics.

Example:

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
- when `attachment.storage` stays on `localfs`, the resolver still gives the selected external card provider package a same-package chance to provide `attachment.storage` first.

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

If the package is not installed there, the resolver cannot load it.

### Export shapes supported today

For a card storage plugin, the loader accepts either:

- named export `cardStoragePlugin`
- default export containing the plugin object

For an attachment storage plugin, the loader accepts either:

- named export `attachmentStoragePlugin`
- default export containing the plugin object

### Error behavior

Missing plugin package:

- `Card storage plugin "x" is not installed. Run: npm install x`
- `Attachment storage plugin "x" is not installed. Run: npm install x`

Invalid plugin export:

- explicit error describing the missing export shape or capability mismatch

This is deliberate: plugin errors should be operator-friendly, not stack-trace archaeology.

---

## Compatibility aliases

The short provider ids `sqlite` and `mysql` are compatibility aliases. They allow existing
`.kanban.json` configurations to continue using the familiar short names while implementation
ownership moves to standalone, versioned npm packages.

| Provider id | Install target      |
| ----------- | ------------------- |
| `sqlite`    | `kl-sqlite-storage` |
| `mysql`     | `kl-mysql-storage`  |

The alias map lives in `PROVIDER_ALIASES` in `src/sdk/plugins/index.ts` and is exported so
downstream tasks and tests can reference it directly.

Resolution rules:

1. If a core built-in implementation is registered for the provider id, use it.
2. Otherwise, look up the provider id in `PROVIDER_ALIASES` and load that package.
3. If there is no alias, treat the provider id as-is (bare npm package name).

This means install errors for `sqlite` and `mysql` always name `kl-sqlite-storage` and
`kl-mysql-storage`, not the short alias.

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

Core no longer owns a first-party MySQL implementation. The provider id `mysql` is a compatibility alias for the external package `kl-mysql-storage`.

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

### Only two capability namespaces today

Supported now:

- `card.storage`
- `attachment.storage`

Future namespaces are possible, but not implemented yet.

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

- you selected the `mysql` compatibility provider id without installing `kl-mysql-storage`, or
- `kl-mysql-storage` is present but its peer driver `mysql2` is missing.

Fix:

```bash
npm install kl-mysql-storage mysql2
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

---

## Quick reference

## Core and compatibility providers

| Namespace | Provider | File-backed | Watch glob | Notes |
|---|---|---:|---|---|
| `card.storage` | `markdown` | yes | `boards/**/*.md` | Default card provider |
| `card.storage` | `sqlite` | no | `null` | Compatibility id backed by `kl-sqlite-storage` |
| `card.storage` | `mysql` | no | `null` | Compatibility id backed by `kl-mysql-storage` |
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
