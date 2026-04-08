/** Stable provider-agnostic identity for the shared remote workspace config document. */
export const CONFIG_REPOSITORY_DOCUMENT_ID = 'workspace-config'

/** Returns the shared remote config document identity used by config.storage providers. */
export function getConfigRepositoryDocumentId(): string {
  return CONFIG_REPOSITORY_DOCUMENT_ID
}
