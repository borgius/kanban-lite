import type { StorageEngine } from './types'
import type { AttachmentStoragePlugin } from './index'
import { createMarkdownAttachmentPlugin, type MarkdownStorageEngine } from './markdown'
import { createMysqlAttachmentPlugin } from './mysql'
import { createSqliteAttachmentPlugin } from './sqlite'

/**
 * Built-in attachment-storage plugin for the local filesystem provider.
 *
 * Delegates to the active built-in card-storage plugin's attachment behavior
 * rather than synthesizing that logic in the central registry.
 *
 * @internal
 */
export function createLocalFsAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin {
  switch (engine.type) {
    case 'markdown':
      return createMarkdownAttachmentPlugin(engine as MarkdownStorageEngine)
    case 'sqlite':
      return createSqliteAttachmentPlugin(engine)
    case 'mysql':
      return createMysqlAttachmentPlugin(engine)
    default:
      throw new Error(
        `No built-in "localfs" attachment provider for engine type "${engine.type}". ` +
        'Supply an attachment-storage plugin for your custom engine.'
      )
  }
}
