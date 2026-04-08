import type {
  AuthSessionState, AuthBanner, MobileSessionClient, MobileSessionStorage,
  MobileSessionExchange, MobileSessionController, ParsedEntry, StoredSessionRecord,
  ShowCredentialsInput, ResolveEntryContext,
} from './session-store-types'
import {
  parseEntryInput, readStoredSession, persistStoredSession,
  createWorkspaceBanner, createCredentialBanner,
} from './session-store-utils'

export function buildMobileSessionController(ctx: ResolveEntryContext): MobileSessionController {
  return {
    getState() {
      return ctx.getState()
    },
    subscribe(listener) {
      ctx.listeners.add(listener)
      return () => {
        ctx.listeners.delete(listener)
      }
    },
    setWorkspaceInput(workspaceInput) {
      ctx.setState((previousState) => ({
        ...previousState,
        workspaceInput,
      }))
    },
    async initialize(initialEntry) {
      const currentOperation = ctx.beginOperation()
      const parsedEntry = parseEntryInput(initialEntry)
      const storedSession = await readStoredSession(ctx.storage)

      if (!ctx.isActiveOperation(currentOperation)) {
        return ctx.getState()
      }

      if (parsedEntry) {
        return ctx.resolveEntry(parsedEntry, {
          operation: currentOperation,
          source: 'deep-link',
          reuseStoredSession: storedSession,
        })
      }

      if (storedSession) {
        return ctx.restoreStoredSession(storedSession, {
          operation: currentOperation,
          workspaceOrigin: storedSession.workspaceOrigin,
          workspaceInput: storedSession.workspaceOrigin,
        })
      }

      ctx.showWorkspaceEntry()
      return ctx.getState()
    },
    async submitWorkspace(workspaceInput) {
      const currentOperation = ctx.beginOperation()
      return ctx.resolveEntry(
        {
          workspaceOrigin: workspaceInput,
          bootstrapToken: null,
          target: null,
        },
        {
          operation: currentOperation,
          source: 'typed',
        },
      )
    },
    async submitCredentials(input) {
      const currentOperation = ctx.beginOperation()
      const workspaceOrigin = ctx.getState().resolvedWorkspaceOrigin

      if (!workspaceOrigin) {
        ctx.showWorkspaceEntry(createWorkspaceBanner(new Error('ERR_MOBILE_WORKSPACE_UNRESOLVED')))
        return ctx.getState()
      }

      ctx.showBusy({
        phase: 'signing-in',
        statusMessage: 'Signing in…',
        workspaceInput: ctx.getState().workspaceInput,
        resolvedWorkspaceOrigin: workspaceOrigin,
        pendingTarget: ctx.getState().pendingTarget,
      })

      try {
        const exchange = await ctx.client.createSession({
          workspaceOrigin,
          username: input.username,
          password: input.password,
        })

        if (!ctx.isActiveOperation(currentOperation)) {
          return ctx.getState()
        }

        await persistStoredSession(ctx.storage, exchange)

        if (!ctx.isActiveOperation(currentOperation)) {
          return ctx.getState()
        }

        ctx.showAuthenticated(exchange, ctx.getState().pendingTarget)
        return ctx.getState()
      } catch {
        if (!ctx.isActiveOperation(currentOperation)) {
          return ctx.getState()
        }

        ctx.showCredentials({
          workspaceInput: ctx.getState().workspaceInput,
          workspaceOrigin,
          pendingTarget: ctx.getState().pendingTarget,
          banner: createCredentialBanner(),
        })
        return ctx.getState()
      }
    },
    async handleIncomingEntry(entryInput, source = 'deep-link') {
      const parsedEntry = parseEntryInput(entryInput)
      const currentOperation = ctx.beginOperation()

      if (!parsedEntry) {
        ctx.showWorkspaceEntry(createWorkspaceBanner(new Error('ERR_MOBILE_WORKSPACE_UNRESOLVED')))
        return ctx.getState()
      }

      return ctx.resolveEntry(parsedEntry, {
        operation: currentOperation,
        source,
      })
    },
    handleQrOutcome(outcome) {
      ctx.setState((previousState) => ({
        ...previousState,
        phase: 'workspace-entry',
        statusMessage: null,
        banner:
          outcome === 'cancelled'
            ? {
                kind: 'notice',
                message: 'QR entry cancelled.',
              }
            : {
                kind: 'error',
                message: 'Camera access is required to scan a QR code. Paste the link instead.',
              },
        sessionStatus: null,
        resolvedWorkspaceOrigin: null,
        pendingTarget: null,
        isProtectedReady: false,
      }))
    },
    clearPendingTarget() {
      ctx.setState((previousState) => ({
        ...previousState,
        pendingTarget: null,
      }))
    },
    async resetWorkspace() {
      return ctx.performExit({ reason: 'workspace-switch' })
    },
    async logout(input) {
      return ctx.performExit({
        reason: input?.reason ?? 'logout',
        status: input?.status,
      })
    },
  }
}
