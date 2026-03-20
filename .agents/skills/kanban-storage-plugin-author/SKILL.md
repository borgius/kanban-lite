---
name: kanban-storage-plugin-author
description: Create a new npm package that implements a kanban-lite storage plugin. Use this whenever the user asks to build a new kanban-lite provider, external storage plugin, `card.storage` plugin, `attachment.storage` plugin, or a package that can be selected in `.kanban.json`. If the backend or package details are incomplete, ask a small batch of targeted questions first, then scaffold the package and wiring.
license: MIT
metadata:
  author: kanban-lite
  version: "1.0.0"
---

# Kanban Storage Plugin Author

Use this skill to create a **new installable npm package** that kanban-lite can load as an external storage provider.

The goal is not just to explain the plugin system. The goal is to leave the user with a **real package scaffold** that:

- builds successfully,
- exports the correct plugin objects,
- includes setup docs,
- and can be selected from `.kanban.json`.

## What this skill should produce

Create a package directory with, at minimum:

- `package.json`
- `tsconfig.json`
- `src/index.ts`
- `README.md`
- optional tests if the user wants them or the implementation is concrete enough to verify

The package should normally export one or both of:

- `cardStoragePlugin`
- `attachmentStoragePlugin`

If the attachment provider supports efficient append-heavy workloads (for example card logs), it may also implement the optional hook:

- `appendAttachment(card, attachment, content)`

## First move

Before writing files:

1. Check whether the current workspace is the kanban-lite core repo or a separate plugin repo.
2. If the kanban-lite docs are present, read the plugin references before scaffolding:
   - `https://github.com/borgius/kanban-lite/blob/main/docs/plugins.md`
   - `https://github.com/borgius/kanban-lite/blob/main/README.md` (Storage Providers / plugin sections)
3. Prefer creating a **new package directory** rather than editing kanban-lite core files, unless the user explicitly asks for an in-repo package.

## Ask only the missing questions

If the request is underspecified, ask a **single small batch** of targeted questions. Keep it to the minimum needed to generate a real package.

Ask about:

1. **Package identity**
   - npm package name
   - provider id
   - output directory
2. **Capability scope**
   - `card.storage`
   - `attachment.storage`
   - both
3. **Backend**
   - local files, SQLite-like DB, remote API, Postgres/MySQL, object storage, etc.
4. **Runtime behavior**
   - file-backed or not
   - should it expose local card paths
   - should it expose a watch glob
5. **Attachments**
   - separate attachment plugin
   - same package exports both capabilities
   - keep attachments on built-in `localfs`
6. **Build/output expectations**
   - TypeScript vs JavaScript
   - require-compatible CommonJS vs dual package
   - whether tests should be included now

If the user already answered some of these, do **not** ask again.

## Sensible defaults

If the user says “just scaffold it” and leaves details vague, default to:

- capability: `card.storage`
- package language: TypeScript
- output: require-compatible CommonJS package with `dist/index.cjs`
- runtime shape: non-file-backed provider
- watch support: none (`null`)
- attachments: keep built-in `localfs` unless the user explicitly wants attachment support in the same package
- docs: include installation + config example

Tell the user when you chose defaults.

## Implementation workflow

### 1. Lock the shape before coding

Make sure the package will export the exact runtime surface kanban-lite expects.

For a card storage plugin, the important shape is:

- `manifest.id`
- `manifest.provides` including `card.storage`
- `createEngine(kanbanDir, options)`
- optional `nodeCapabilities`

For an attachment plugin, the important shape is:

- `manifest.id`
- `manifest.provides` including `attachment.storage`
- `copyAttachment(...)`
- optional `appendAttachment(...)` when the backend can efficiently append in-place
- plus either `getCardDir(...)` or `materializeAttachment(...)`

Use `references/provider-contracts.md` for the compact contract summary.

### 2. Create a real package, not just interfaces

Do **not** stop after generating types or empty files. Create a compileable package scaffold.

That means:

- valid `package.json`
- build script
- exports map
- source entry file
- README with install/config instructions
- docs that match the real contract, including any optional hooks like `appendAttachment(...)`

Use the bundled templates as a starting point when they fit:

- `templates/package.json.template.json`
- `templates/tsconfig.json.template.json`
- `templates/src/index.template.ts`
- `templates/README.template.md`

### 3. Prefer structural local interfaces over unstable deep imports

kanban-lite currently validates external plugins by runtime shape. The plugin-author API is not yet a polished stable package surface.

That means the safest default is:

- define the minimal local interfaces your plugin package needs,
- optionally import broad public SDK types from `kanban-lite/sdk` when they are actually exported and useful,
- avoid depending on private deep internal paths from the kanban-lite repo.

### 4. Keep packaging compatible with runtime loading

The runtime loads external plugins with `createRequire(...)`, so the safest output is a require-compatible package.

Prefer one of these:

- CommonJS output only
- dual package with a `require` export

Avoid pure ESM-only output unless the user explicitly wants to take on that compatibility risk.

### 5. Make backend dependencies lazy when appropriate

If the provider depends on a heavy or optional runtime driver — for example a database driver — load it lazily and surface an actionable install error.

Good pattern:

- only require the driver when the engine is created or initialized
- throw a clear message such as `Install it with: npm install <driver>`

### 6. Be explicit about node capabilities

If the provider is not file-backed, say so in `nodeCapabilities`.

Typical non-file-backed behavior:

- `isFileBacked: false`
- `getLocalCardPath(): null`
- `getWatchGlob(): null`

If it **is** file-backed, return real values and document them.

### 7. Document `.kanban.json` usage

The README you generate for the new package should always include:

- install command
- exported provider id
- example `.kanban.json`
- required options
- whether attachments are handled by this package or left to `localfs`
- whether optional behaviors such as `appendAttachment(...)` are supported, and when the runtime falls back to normal rewrite behavior

If you are changing the core kanban-lite repo while adding or evolving plugin behavior, update the related first-party docs in the same task — especially `docs/plugins.md`, `README.md`, and `CHANGELOG.md`.

### 8. Validate before stopping

Whenever possible:

- run the package build
- check TypeScript errors
- ensure the exported object names are exact
- make sure the README example matches the actual provider id and options
- make sure any append/log behavior described in docs matches the actual runtime fallback behavior

## Output expectations

At the end, provide a concise summary covering:

- package path created
- capability/capabilities implemented
- any defaults you chose
- what still needs user-specific backend logic, if anything

## Good behavior

- Ask a few questions **only when the missing information blocks a real scaffold**.
- Prefer concrete files over long prose.
- Keep the package independent and installable.
- Keep the README practical.
- Avoid modifying kanban-lite core code unless the user explicitly asks.
- Keep related docs in sync when the contract changes; don’t land a plugin/runtime change without updating the relevant authoring and deep-dive docs.

## Avoid these mistakes

- Do not generate only a theory document.
- Do not export the wrong symbol names.
- Do not assume every provider is file-backed.
- Do not hard-code private kanban-lite source imports into a third-party package.
- Do not leave the user with an unbuildable scaffold unless they explicitly asked for pseudocode only.
