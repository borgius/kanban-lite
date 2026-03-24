import type { StorageEngine } from './types';
import type { AttachmentStoragePlugin } from './index';
/**
 * Built-in attachment-storage plugin for the local filesystem provider.
 *
 * Delegates to the active card-storage engine's local attachment behavior
 * rather than hard-coding provider-specific branches in the registry.
 *
 * @internal
 */
export declare function createLocalFsAttachmentPlugin(engine: StorageEngine): AttachmentStoragePlugin;
