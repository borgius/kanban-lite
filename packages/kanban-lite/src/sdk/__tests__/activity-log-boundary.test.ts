import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { readConfig, writeConfig } from '../../shared/config'
import type { LogEntry } from '../../shared/types'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-activity-log-boundary-'))
}

function getActivity(entry: LogEntry): Record<string, unknown> {
  return (entry.object?.activity ?? {}) as Record<string, unknown>
}

describe('shared unread-driving activity log surface', () => {
  let workspaceDir: string
  let kanbanDir: string
  let sdk: KanbanSDK

  beforeEach(async () => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
    sdk = new KanbanSDK(kanbanDir)
    await sdk.init()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sdk.close()
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('persists comment create/update/delete, card edits, forms, actions, and explicit logs through the same readable activity surface', async () => {
    const config = readConfig(workspaceDir)
    writeConfig(workspaceDir, {
      ...config,
      actionWebhookUrl: 'https://example.com/actions',
      forms: {
        checklist: {
          schema: {
            type: 'object',
            properties: {
              approved: { type: 'boolean' },
            },
          },
        },
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' }))

    const card = await sdk.createCard({ content: '# Activity Surface', actions: ['retry'] })
    await sdk.updateCard(card.id, { forms: [{ name: 'checklist' }] })

    await sdk.addComment(card.id, 'alice', 'First comment')
    await sdk.updateComment(card.id, 'c1', 'Edited comment')
    await sdk.deleteComment(card.id, 'c1')
    await sdk.updateCard(card.id, { priority: 'high', labels: ['customer'] })
    await sdk.submitForm({ cardId: card.id, formId: 'checklist', data: { approved: true } })
    await sdk.triggerAction(card.id, 'retry')
    await sdk.addLog(card.id, 'Operator note', { source: 'operator', object: { noteId: 'n1' } })

    const logs = await sdk.listLogs(card.id)
    expect(logs).toHaveLength(7)
    expect(logs.map((entry) => getActivity(entry).type)).toEqual([
      'comment.created',
      'comment.updated',
      'comment.deleted',
      'card.updated',
      'form.submitted',
      'card.action.triggered',
      'log.explicit',
    ])

    expect(getActivity(logs[0])).toMatchObject({
      type: 'comment.created',
      qualifiesForUnread: true,
    })
    expect(logs[0].object).toMatchObject({ commentId: 'c1', author: 'alice' })
    expect(getActivity(logs[1])).toMatchObject({
      type: 'comment.updated',
      qualifiesForUnread: true,
    })
    expect(logs[1].object).toMatchObject({ commentId: 'c1' })
    expect(getActivity(logs[2])).toMatchObject({
      type: 'comment.deleted',
      qualifiesForUnread: true,
    })
    expect(logs[2].object).toMatchObject({ commentId: 'c1' })
    expect(getActivity(logs[3])).toMatchObject({
      type: 'card.updated',
      qualifiesForUnread: true,
    })
    expect(logs[3].object).toMatchObject({ fields: ['priority', 'labels'] })
    expect(logs[4]).toMatchObject({
      text: 'Form submitted: `Checklist`',
      object: {
        formId: 'checklist',
        formName: 'Checklist',
        payload: { approved: true },
        activity: {
          type: 'form.submitted',
          qualifiesForUnread: true,
        },
      },
    })
    expect(getActivity(logs[5])).toMatchObject({
      type: 'card.action.triggered',
      qualifiesForUnread: true,
    })
    expect(logs[5].object).toMatchObject({ action: 'retry' })

    expect(logs.at(-1)).toMatchObject({
      source: 'operator',
      text: 'Operator note',
      object: {
        noteId: 'n1',
        activity: {
          type: 'log.explicit',
          qualifiesForUnread: true,
        },
      },
    })
  })

  it('does not create unread-driving activity for passive reads or active-card navigation', async () => {
    const card = await sdk.createCard({ content: '# Passive Surface' })

    await sdk.getCard(card.id)
    await sdk.listCards()
    await sdk.listComments(card.id)
    await sdk.listLogs(card.id)
    await sdk.setActiveCard(card.id)
    await sdk.getActiveCard()

    expect(await sdk.listLogs(card.id)).toEqual([])
  })
})
