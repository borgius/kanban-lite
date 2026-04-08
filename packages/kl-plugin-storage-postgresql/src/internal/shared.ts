import type { Card } from 'kanban-lite/sdk'

// ---------------------------------------------------------------------------
// Local structural interfaces — avoids deep imports from kanban-lite internals.
// Validated by runtime shape checks in the kanban-lite plugin loader.
// ---------------------------------------------------------------------------

export type Comment = Card['comments'][number]

export interface ConfigStorageProviderManifest {
  readonly id: string
  readonly provides: readonly string[]
}

export interface ConfigStorageModuleContext {
  workspaceRoot: string
  documentId: string
  provider: string
  backend: 'builtin' | 'external'
  options?: Record<string, unknown>
  worker?: unknown
}

export interface ConfigStorageProviderPlugin {
  readonly manifest: ConfigStorageProviderManifest
  readConfigDocument(): Record<string, unknown> | null | undefined
  writeConfigDocument(document: Record<string, unknown>): void
}
