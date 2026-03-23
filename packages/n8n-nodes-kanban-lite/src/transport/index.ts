/**
 * Shared transport abstraction for Kanban Lite n8n nodes.
 *
 * @see {@link KanbanLiteTransport} for the core interface.
 * @see {@link SdkTransport} for the local SDK adapter.
 * @see {@link ApiTransport} for the remote API adapter.
 */

export type {
  ApiTransportCredentials,
  EventCapabilityEntry,
  KanbanLiteResult,
  KanbanLiteTransport,
  SdkTransportCredentials,
  SubscribeOptions,
  TransportMode,
  TriggerRegistration,
} from './types'
export { KanbanTransportError } from './types'

export type { KanbanSdkLike, SdkTransportOptions } from './sdkAdapter'
export { SdkTransport } from './sdkAdapter'

export type { ApiTransportOptions, FetchFn } from './apiAdapter'
export { ApiTransport } from './apiAdapter'

export { DEFAULT_EVENT_CAPABILITIES, buildApiHeaders, normalizeResult, resolveApiRoute, throwApiError } from './normalize'
