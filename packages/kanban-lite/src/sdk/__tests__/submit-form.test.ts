import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'
import { readConfig, writeConfig } from '../../shared/config'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-submit-form-test-'))
}

describe('KanbanSDK.submitForm', () => {
  let workspaceDir: string
  let kanbanDir: string

  beforeEach(() => {
    workspaceDir = createTempDir()
    kanbanDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(kanbanDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  it('submits a reusable attached form, persists the data, and emits form.submit with context', async () => {
    const config = readConfig(workspaceDir)
    writeConfig(workspaceDir, {
      ...config,
      forms: {
        'bug-report': {
          schema: {
            type: 'object',
            required: ['title', 'severity', 'reporter'],
            properties: {
              title: { type: 'string' },
              severity: { type: 'string' },
              reporter: { type: 'string' }
            }
          },
          data: {
            title: 'Config Title',
            severity: 'medium'
          }
        }
      }
    })

    const events: Array<{ type: string; data: unknown }> = []
    const sdk = new KanbanSDK(kanbanDir, {
      onEvent: (type, data) => events.push({ type, data })
    })
    await sdk.init()

    const card = await sdk.createCard({
      content: '# Bug card',
      metadata: { reporter: 'Alice', ignored: 'nope' }
    })

    await sdk.updateCard(card.id, {
      forms: [{ name: 'bug-report' }],
      formData: {
        'bug-report': { severity: 'high' }
      }
    })

    const result = await sdk.submitForm({
      cardId: card.id,
      formId: 'bug-report',
      data: { title: 'Submitted Title' }
    })

    expect(result.boardId).toBe('default')
    expect(result.form.id).toBe('bug-report')
    expect(result.form.fromConfig).toBe(true)
    expect(result.form.name).toBe('Bug Report')
    expect(result.form.description).toBe('')
    expect(result.form.initialData).toEqual({
      title: 'Config Title',
      severity: 'high',
      reporter: 'Alice'
    })
    expect(result.data).toEqual({
      title: 'Submitted Title',
      severity: 'high',
      reporter: 'Alice'
    })

    const reloaded = await sdk.getCard(card.id)
    expect(reloaded?.formData?.['bug-report']).toEqual(result.data)
    expect(reloaded?.attachments).toContain(`${card.id}.log`)

    const logs = await sdk.listLogs(card.id)
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({
      source: 'system',
      text: 'Form submitted: `Bug Report`',
      object: {
        formId: 'bug-report',
        formName: 'Bug Report',
        payload: result.data,
      },
    })

    const submitEvent = events.find(event => event.type === 'form.submitted')
    expect(submitEvent).toBeTruthy()
    expect(submitEvent?.data).toMatchObject({
      event: 'form.submitted',
      data: {
        boardId: 'default',
        data: result.data,
        form: {
          id: 'bug-report',
          name: 'Bug Report',
          description: '',
          label: 'Bug Report',
          fromConfig: true
        },
        card: {
          id: card.id,
          boardId: 'default',
          attachments: [`${card.id}.log`],
        }
      }
    })
  })

  it('applies merge precedence collisions in the documented order and emits log.added plus form.submitted', async () => {
    const config = readConfig(workspaceDir)
    writeConfig(workspaceDir, {
      ...config,
      forms: {
        'bug-report': {
          schema: {
            type: 'object',
            properties: {
              shared: { type: 'string' },
              baseOnly: { type: 'string' },
              attachmentWins: { type: 'string' },
              cardWins: { type: 'string' },
              metadataWins: { type: 'string' },
              submitWins: { type: 'string' }
            }
          },
          data: {
            shared: 'config',
            baseOnly: 'config',
            attachmentWins: 'config',
            cardWins: 'config',
            metadataWins: 'config'
          }
        }
      }
    })

    const events: Array<{ type: string; data: unknown }> = []
    const sdk = new KanbanSDK(kanbanDir, {
      onEvent: (type, data) => events.push({ type, data })
    })
    await sdk.init()

    const card = await sdk.createCard({
      content: '# Precedence card',
      metadata: {
        shared: 'metadata',
        metadataWins: 'metadata',
        ignored: 'not-in-schema'
      }
    })

    await sdk.updateCard(card.id, {
      forms: [{
        name: 'bug-report',
        data: {
          shared: 'attachment',
          attachmentWins: 'attachment'
        }
      }],
      formData: {
        'bug-report': {
          shared: 'card',
          cardWins: 'card'
        }
      }
    })

    events.length = 0

    const result = await sdk.submitForm({
      cardId: card.id,
      formId: 'bug-report',
      data: {
        shared: 'submitted',
        submitWins: 'submitted'
      }
    })

    expect(result.form.initialData).toEqual({
      shared: 'metadata',
      baseOnly: 'config',
      attachmentWins: 'attachment',
      cardWins: 'card',
      metadataWins: 'metadata'
    })
    expect(result.data).toEqual({
      shared: 'submitted',
      baseOnly: 'config',
      attachmentWins: 'attachment',
      cardWins: 'card',
      metadataWins: 'metadata',
      submitWins: 'submitted'
    })
    expect((await sdk.getCard(card.id))?.formData?.['bug-report']).toEqual(result.data)
    // Filter out auth lifecycle events and before-events; only check mutation after-events and log events
    const mutationEvents = events.filter(e => !e.type.startsWith('auth.') && e.type !== 'form.submit' && e.type !== 'log.add').map(e => e.type)
    expect(mutationEvents).toEqual(['log.added', 'form.submitted'])
  })

  it('supports inline attached forms and merges attachment defaults before validation', async () => {
    const sdk = new KanbanSDK(kanbanDir)
    await sdk.init()

    const card = await sdk.createCard({
      content: '# Inline form card',
      metadata: { owner: 'Team Blue' }
    })

    await sdk.updateCard(card.id, {
      forms: [
        {
          schema: {
            type: 'object',
            title: 'Release Checklist',
            required: ['status', 'owner'],
            properties: {
              status: { type: 'string' },
              owner: { type: 'string' }
            }
          },
          data: { status: 'draft' }
        }
      ]
    })

    const result = await sdk.submitForm({
      cardId: card.id,
      formId: 'release-checklist',
      data: {}
    })

    expect(result.form.initialData).toEqual({ status: 'draft', owner: 'Team Blue' })
    expect(result.data).toEqual({ status: 'draft', owner: 'Team Blue' })
    expect((await sdk.getCard(card.id))?.formData?.['release-checklist']).toEqual(result.data)
  })

  it('rejects invalid submissions before persistence and before event emission', async () => {
    const config = readConfig(workspaceDir)
    writeConfig(workspaceDir, {
      ...config,
      forms: {
        checklist: {
          schema: {
            type: 'object',
            required: ['approved'],
            properties: {
              approved: { type: 'boolean' }
            }
          }
        }
      }
    })

    const events: Array<{ type: string; data: unknown }> = []
    const sdk = new KanbanSDK(kanbanDir, {
      onEvent: (type, data) => events.push({ type, data })
    })
    await sdk.init()

    const card = await sdk.createCard({ content: '# Invalid form test' })
    await sdk.updateCard(card.id, {
      forms: [{ name: 'checklist' }],
      formData: {
        checklist: { approved: true }
      }
    })

    await expect(sdk.submitForm({
      cardId: card.id,
      formId: 'checklist',
      data: { approved: 'yes please' as unknown as boolean }
    })).rejects.toThrow('Invalid form submission for checklist')

    const reloaded = await sdk.getCard(card.id)
    expect(reloaded?.formData?.checklist).toEqual({ approved: true })
    expect(events.some(event => event.type === 'form.submitted')).toBe(false)
  })

  it('persists submitted form state with matching semantics in sqlite storage mode', async () => {
    const sdk = new KanbanSDK(kanbanDir, {
      storageEngine: 'sqlite',
      sqlitePath: path.join(kanbanDir, 'kanban.db')
    })
    await sdk.init()

    const card = await sdk.createCard({
      content: '# Sqlite form card',
      metadata: { owner: 'DB Team' }
    })

    await sdk.updateCard(card.id, {
      forms: [{
        schema: {
          type: 'object',
          title: 'Database Checklist',
          required: ['status', 'owner'],
          properties: {
            status: { type: 'string' },
            owner: { type: 'string' }
          }
        },
        data: { status: 'draft' }
      }]
    })

    const result = await sdk.submitForm({
      cardId: card.id,
      formId: 'database-checklist',
      data: { status: 'ready' }
    })

    expect(result.form.initialData).toEqual({ status: 'draft', owner: 'DB Team' })
    expect(result.data).toEqual({ status: 'ready', owner: 'DB Team' })
    expect((await sdk.getCard(card.id))?.formData?.['database-checklist']).toEqual({
      status: 'ready',
      owner: 'DB Team'
    })
  })

  it('interpolates ${path} placeholders in config defaults, attachment defaults, and persisted formData against card context', async () => {
    const config = readConfig(workspaceDir)
    writeConfig(workspaceDir, {
      ...config,
      forms: {
        ticket: {
          schema: {
            type: 'object',
            required: ['ref', 'team', 'label'],
            properties: {
              ref: { type: 'string' },
              team: { type: 'string' },
              label: { type: 'string' },
            }
          },
          data: {
            ref: '${id}',
            team: '${metadata.team}',
          }
        }
      }
    })

    const sdk = new KanbanSDK(kanbanDir)
    await sdk.init()

    const card = await sdk.createCard({
      content: '# Placeholder card',
      metadata: { team: 'platform' }
    })

    await sdk.updateCard(card.id, {
      forms: [{
        name: 'ticket',
        data: { label: 'Card ${id} [${status}]' }
      }]
    })

    const result = await sdk.submitForm({
      cardId: card.id,
      formId: 'ticket',
      data: {}
    })

    expect(result.form.initialData).toEqual({
      ref: card.id,
      team: 'platform',
      label: `Card ${card.id} [backlog]`,
    })
    expect(result.data).toEqual(result.form.initialData)
    expect((await sdk.getCard(card.id))?.formData?.['ticket']).toEqual(result.data)
  })

  it('interpolates placeholders in persisted formData before metadata overlay, with metadata overlay taking precedence', async () => {
    const config = readConfig(workspaceDir)
    writeConfig(workspaceDir, {
      ...config,
      forms: {
        meta: {
          schema: {
            type: 'object',
            properties: {
              owner: { type: 'string' },
              note: { type: 'string' },
            }
          }
        }
      }
    })

    const sdk = new KanbanSDK(kanbanDir)
    await sdk.init()

    const card = await sdk.createCard({
      content: '# Meta card',
      metadata: { owner: 'real-owner' }
    })

    await sdk.updateCard(card.id, {
      forms: [{ name: 'meta' }],
      formData: {
        meta: {
          owner: '${id}',
          note: 'assigned to ${assignee}',
        }
      }
    })

    const result = await sdk.submitForm({
      cardId: card.id,
      formId: 'meta',
      data: {}
    })

    // metadata overlay (owner: 'real-owner') wins over persisted '${id}' placeholder
    expect(result.form.initialData).toEqual({
      owner: 'real-owner',
      note: 'assigned to ',
    })
  })
})
