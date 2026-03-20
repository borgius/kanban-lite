import type { StorageEngine } from './types'
import type { AttachmentStoragePlugin } from './index'

/**
 * Built-in attachment-storage plugin for the local filesystem provider.
 *
 * Delegates to the active card-storage engine's local attachment behavior
 * rather than hard-coding provider-specific branches in the registry.
 *
 * @internal
 */
export function createLocalFsAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin {
  return {
    manifest: { id: 'localfs', provides: ['attachment.storage'] },
    getCardDir(card) {
      return engine.getCardDir(card)
    },
    async copyAttachment(sourcePath, card) {
      await engine.copyAttachment(sourcePath, card)
    },
  }
}
