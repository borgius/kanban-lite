import * as http from 'http'
import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'
import { serializeCard } from '../sdk/parser'
import type { StandaloneContext } from './context'
import { broadcast, broadcastCardContentToEditingClients, buildInitMessage, getClientsEditingCard, loadCards } from './broadcastService'

export function cleanupTempFile(ctx: StandaloneContext): void {
  if (ctx.tempFileWatcher) {
    ctx.tempFileWatcher.close()
    ctx.tempFileWatcher = undefined
  }
  if (ctx.tempFilePath) {
    try { fs.unlinkSync(ctx.tempFilePath) } catch { /* ignore */ }
    ctx.tempFilePath = undefined
  }
  ctx.tempFileCardId = undefined
  ctx.tempFileAuthContext = undefined
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function isIgnorableWatcherTeardownError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/')
  let pattern = '^'

  for (let index = 0; index < normalized.length; index++) {
    const char = normalized[index]

    if (char === '*') {
      const next = normalized[index + 1]
      const afterNext = normalized[index + 2]
      if (next === '*') {
        pattern += afterNext === '/' ? '(?:.*/)?' : '.*'
        index += afterNext === '/' ? 2 : 1
      } else {
        pattern += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      pattern += '[^/]'
      continue
    }

    pattern += escapeRegex(char)
  }

  return new RegExp(`${pattern}$`)
}

function handleFileChange(
  ctx: StandaloneContext,
  debounceRef: { timer: ReturnType<typeof setTimeout> | undefined },
  lifecycleRef: { closed: boolean },
  changedPath?: string,
): void {
  if (lifecycleRef.closed) return
  if (ctx.migrating) return
  if (Date.now() < ctx.suppressWatcherEventsUntil) return
  if (debounceRef.timer) clearTimeout(debounceRef.timer)
  debounceRef.timer = setTimeout(async () => {
    if (lifecycleRef.closed) return
    if (ctx.migrating) return
    if (Date.now() < ctx.suppressWatcherEventsUntil) return
    ctx.migrating = true
    try {
      await loadCards(ctx)
      if (lifecycleRef.closed) return
      broadcast(ctx, buildInitMessage(ctx))
    } catch (error) {
      if (lifecycleRef.closed && isIgnorableWatcherTeardownError(error)) return
      console.error('Failed to refresh standalone state after watched file change:', error)
    } finally {
      ctx.migrating = false
    }

    if (lifecycleRef.closed) return

    if (changedPath) {
      const editingCard = ctx.cards.find((card) => getClientsEditingCard(ctx, card.id).length > 0 && ctx.sdk.getLocalCardPath(card) === changedPath)
      if (editingCard) {
        const currentContent = serializeCard(editingCard)
        if (currentContent !== ctx.lastWrittenContent) {
          void broadcastCardContentToEditingClients(ctx, editingCard)
        }
      }
    }
  }, 100)
}

export function setupWatcher(ctx: StandaloneContext, server: http.Server): void {
  const debounceRef: { timer: ReturnType<typeof setTimeout> | undefined } = { timer: undefined }
  const lifecycleRef = { closed: false }

  server.on('close', () => {
    lifecycleRef.closed = true
    if (debounceRef.timer) {
      clearTimeout(debounceRef.timer)
      debounceRef.timer = undefined
    }
  })

  const watchGlob = ctx.sdk.getStorageStatus().watchGlob
  if (watchGlob) {
    let watcherReady = false
    const watchPattern = globToRegExp(watchGlob)
    const shouldHandleWatchPath = (watchedPath: string): boolean => {
      const relativePath = path.relative(ctx.absoluteKanbanDir, watchedPath).replace(/\\/g, '/')
      return !relativePath.startsWith('../') && watchPattern.test(relativePath)
    }
    const watcher = chokidar.watch(ctx.absoluteKanbanDir, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 100 }
    })

    watcher.on('ready', () => { watcherReady = true })
    watcher.on('change', (p) => watcherReady && shouldHandleWatchPath(p) && handleFileChange(ctx, debounceRef, lifecycleRef, p))
    watcher.on('add', (p) => watcherReady && shouldHandleWatchPath(p) && handleFileChange(ctx, debounceRef, lifecycleRef, p))
    watcher.on('unlink', (p) => watcherReady && shouldHandleWatchPath(p) && handleFileChange(ctx, debounceRef, lifecycleRef, p))

    server.on('close', () => {
      watcher.close()
      ctx.wss.close()
    })
  } else {
    server.on('close', () => {
      ctx.sdk.close()
      ctx.wss.close()
    })
  }

  // Watch .kanban.json for config changes and re-broadcast init on change
  const configFilePath = path.join(ctx.workspaceRoot, '.kanban.json')
  const configWatcher = chokidar.watch(configFilePath, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 }
  })
  configWatcher.on('change', () => handleFileChange(ctx, debounceRef, lifecycleRef))
  server.on('close', () => configWatcher.close())
}
