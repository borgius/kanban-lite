# kanban-lite plugin contracts

Use this reference when scaffolding a third-party storage package.

## Card storage plugin contract

A card storage plugin is validated by runtime shape.

Expected export:

- `cardStoragePlugin`

Expected object shape:

```ts
interface PluginManifest {
  id: string
  provides: readonly ('card.storage' | 'attachment.storage')[]
}

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

`manifest.provides` must include `card.storage`.

## Attachment storage plugin contract

Expected export:

- `attachmentStoragePlugin`

Expected object shape:

```ts
interface AttachmentStoragePlugin {
  manifest: PluginManifest
  copyAttachment(sourcePath: string, card: Card): Promise<void>
  getCardDir?(card: Card): string | null
  materializeAttachment?(card: Card, attachment: string): Promise<string | null>
}
```

`manifest.provides` must include `attachment.storage`.

The attachment plugin must provide `copyAttachment(...)` and at least one of:

- `getCardDir(...)`
- `materializeAttachment(...)`

## Storage engine contract

A card storage plugin returns a storage engine object from `createEngine(...)`.

Core shape:

```ts
interface StorageEngine {
  readonly type: string
  readonly kanbanDir: string
  init(): Promise<void>
  close(): void
  migrate(): Promise<void>
  ensureBoardDirs(boardDir: string, extraStatuses?: string[]): Promise<void>
  deleteBoardData(boardDir: string, boardId: string): Promise<void>
  scanCards(boardDir: string, boardId: string): Promise<Card[]>
  writeCard(card: Card): Promise<void>
  moveCard(card: Card, boardDir: string, newStatus: string): Promise<string>
  renameCard(card: Card, newFilename: string): Promise<string>
  deleteCard(card: Card): Promise<void>
  getCardDir(card: Card): string
  copyAttachment(sourcePath: string, card: Card): Promise<void>
}
```

## Packaging guidance

- Prefer CommonJS output or a dual package with a `require` export.
- External plugins are loaded through Node `require(...)` semantics.
- Avoid deep private imports from kanban-lite internals.
- Prefer local structural interfaces unless a public `kanban-lite/sdk` type is enough.

## README checklist

Every generated plugin package README should document:

1. package install command
2. provider id
3. supported capability namespaces
4. required options
5. `.kanban.json` example
6. whether the package also exports `attachmentStoragePlugin`
7. whether the provider is file-backed
8. any optional runtime driver install step
