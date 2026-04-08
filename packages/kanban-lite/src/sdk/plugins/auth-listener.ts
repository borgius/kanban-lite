import type {
  AuthContext,
  AuthErrorCategory,
  BeforeEventPayload,
  SDKBeforeEventType,
  SDKEventListenerPlugin,
  SDKEventListener,
} from '../types'
import { AuthError } from '../types'
import type { AuthIdentity, AuthIdentityPlugin, AuthPolicyPlugin } from './auth-plugins'

// ---------------------------------------------------------------------------
// Canonical SDK before-event names
// ---------------------------------------------------------------------------

export const SDK_BEFORE_EVENT_NAMES: readonly SDKBeforeEventType[] = [
  'card.create',
  'card.update',
  'card.move',
  'card.delete',
  'card.transfer',
  'card.action.trigger',
  'card.checklist.add',
  'card.checklist.edit',
  'card.checklist.delete',
  'card.checklist.check',
  'card.checklist.uncheck',
  'card.purgeDeleted',
  'comment.create',
  'comment.update',
  'comment.delete',
  'column.create',
  'column.update',
  'column.delete',
  'column.reorder',
  'column.setMinimized',
  'column.cleanup',
  'attachment.add',
  'attachment.remove',
  'settings.update',
  'board.create',
  'board.update',
  'board.delete',
  'board.action.config.add',
  'board.action.config.remove',
  'board.action.trigger',
  'board.setDefault',
  'log.add',
  'log.clear',
  'board.log.add',
  'board.log.clear',
  'storage.migrate',
  'label.set',
  'label.rename',
  'label.delete',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  'form.submit',
]

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function isBeforeEventPayload(value: unknown): value is BeforeEventPayload<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return false
  const payload = value as BeforeEventPayload<Record<string, unknown>>
  return typeof payload.event === 'string'
    && SDK_BEFORE_EVENT_NAMES.includes(payload.event as SDKBeforeEventType)
    && typeof payload.input === 'object'
    && payload.input !== null
}

function toAuthErrorCategory(reason?: AuthErrorCategory, identity?: AuthIdentity | null): AuthErrorCategory {
  if (reason) return reason
  return identity ? 'auth.policy.denied' : 'auth.identity.missing'
}

function withAuthHints(
  context: AuthContext | undefined,
  payload: BeforeEventPayload<Record<string, unknown>>,
): AuthContext {
  const merged: AuthContext = { ...(context ?? {}) }
  const input = payload.input
  const setString = (
    key: 'actorHint' | 'boardId' | 'cardId' | 'fromBoardId' | 'toBoardId' | 'columnId' | 'labelName' | 'commentId' | 'attachment' | 'actionKey' | 'formId',
    value: unknown,
  ): void => {
    if (typeof value === 'string' && value.length > 0) merged[key] = value
  }

  setString('boardId', payload.boardId)
  setString('boardId', input.boardId)
  setString('cardId', input.cardId)
  setString('fromBoardId', input.fromBoardId)
  setString('toBoardId', input.toBoardId)
  setString('columnId', input.columnId)
  setString('commentId', input.commentId)
  setString('attachment', input.attachment)
  setString('actionKey', input.actionKey)
  setString('formId', input.formId)
  setString('labelName', input.labelName)

  if (!merged.columnId) setString('columnId', input.targetStatus)
  if (!merged.actionKey) setString('actionKey', input.action)
  if (!merged.actionKey) setString('actionKey', input.key)
  if (!merged.labelName) setString('labelName', input.name)
  if (!merged.labelName) setString('labelName', input.oldName)

  return merged
}

// ---------------------------------------------------------------------------
// Exported factory
// ---------------------------------------------------------------------------

/**
 * Creates the built-in auth event listener plugin that enforces authorization
 * during the before-event phase.
 *
 * @param authIdentity - Resolved identity provider used to establish the caller.
 * @param authPolicy   - Resolved policy provider used to authorize each action.
 * @param getAuthContext - Optional accessor for the active scoped auth context.
 */
export function createBuiltinAuthListenerPlugin(
  authIdentity: AuthIdentityPlugin,
  authPolicy: AuthPolicyPlugin,
  getAuthContext?: () => AuthContext | undefined,
): SDKEventListenerPlugin {
  const subscriptions: Array<() => void> = []
  return {
    manifest: { id: 'builtin:auth-listener', provides: ['event.listener'] },
    register(bus: import('../eventBus').EventBus): void {
      if (subscriptions.length > 0) return

      const listener = async (payload: BeforeEventPayload<Record<string, unknown>>): Promise<void> => {
        if (!isBeforeEventPayload(payload)) return

        const context = withAuthHints(getAuthContext?.(), payload)
        const action = payload.event
        const identity = await authIdentity.resolveIdentity(context)
        const decision = await authPolicy.checkPolicy(identity, action, context)
        const actor = decision.actor ?? identity?.subject ?? payload.actor
        const boardId = payload.boardId ?? context.boardId

        if (!decision.allowed) {
          bus.emit('auth.denied', {
            type: 'auth.denied',
            data: {
              action,
              reason: toAuthErrorCategory(decision.reason, identity),
              actor,
            },
            timestamp: new Date().toISOString(),
            actor,
            boardId,
          })

          throw new AuthError(
            toAuthErrorCategory(decision.reason, identity),
            `Action "${action}" denied${actor ? ` for "${actor}"` : ''}`,
            actor,
          )
        }

        bus.emit('auth.allowed', {
          type: 'auth.allowed',
          data: { action, actor },
          timestamp: new Date().toISOString(),
          actor,
          boardId,
        })
      }

      for (const event of SDK_BEFORE_EVENT_NAMES) {
        subscriptions.push(bus.on(event, listener as unknown as SDKEventListener))
      }
    },
    unregister(): void {
      while (subscriptions.length > 0) {
        subscriptions.pop()?.()
      }
    },
  }
}
