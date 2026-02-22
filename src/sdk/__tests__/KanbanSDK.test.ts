import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KanbanSDK } from '../KanbanSDK'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-sdk-test-'))
}

function writeCardFile(dir: string, filename: string, content: string, subfolder?: string): void {
  const targetDir = subfolder ? path.join(dir, subfolder) : dir
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(path.join(targetDir, filename), content, 'utf-8')
}

function makeCardContent(opts: {
  id: string
  status?: string
  priority?: string
  title?: string
  order?: string
  assignee?: string | null
  dueDate?: string | null
  labels?: string[]
}): string {
  const {
    id,
    status = 'backlog',
    priority = 'medium',
    title = 'Test Card',
    order = 'a0',
    assignee = null,
    dueDate = null,
    labels = []
  } = opts
  return `---
id: "${id}"
status: "${status}"
priority: "${priority}"
assignee: ${assignee ? `"${assignee}"` : 'null'}
dueDate: ${dueDate ? `"${dueDate}"` : 'null'}
created: "2025-01-01T00:00:00.000Z"
modified: "2025-01-01T00:00:00.000Z"
completedAt: null
labels: [${labels.map(l => `"${l}"`).join(', ')}]
order: "${order}"
---
# ${title}

Description here.`
}

describe('KanbanSDK', () => {
  let workspaceDir: string
  let tempDir: string // featuresDir (alias kept for minimal test changes)
  let sdk: KanbanSDK

  beforeEach(() => {
    workspaceDir = createTempDir()
    tempDir = path.join(workspaceDir, '.kanban')
    fs.mkdirSync(tempDir, { recursive: true })
    sdk = new KanbanSDK(tempDir)
  })

  afterEach(() => {
    fs.rmSync(workspaceDir, { recursive: true, force: true })
  })

  describe('init', () => {
    it('should create the features directory', async () => {
      await sdk.init()
      expect(fs.existsSync(tempDir)).toBe(true)
    })
  })

  describe('listCards', () => {
    it('should return empty array for empty directory', async () => {
      const cards = await sdk.listCards()
      expect(cards).toEqual([])
    })

    it('should list cards from status subfolders', async () => {
      writeCardFile(tempDir, 'active.md', makeCardContent({ id: 'active', status: 'todo', order: 'a0' }), 'todo')
      writeCardFile(tempDir, 'completed.md', makeCardContent({ id: 'completed', status: 'done', order: 'a1' }), 'done')

      const cards = await sdk.listCards()
      expect(cards.length).toBe(2)
      expect(cards.map(c => c.id).sort()).toEqual(['active', 'completed'])
    })

    it('should return cards sorted by order', async () => {
      writeCardFile(tempDir, 'b.md', makeCardContent({ id: 'b', order: 'b0' }), 'backlog')
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', order: 'a0' }), 'backlog')

      const cards = await sdk.listCards()
      expect(cards[0].id).toBe('a')
      expect(cards[1].id).toBe('b')
    })

    it('should skip files without valid frontmatter', async () => {
      writeCardFile(tempDir, 'invalid.md', '# No frontmatter', 'backlog')
      writeCardFile(tempDir, 'valid.md', makeCardContent({ id: 'valid' }), 'backlog')

      const cards = await sdk.listCards()
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('valid')
    })

    it('should also load orphaned root-level files for backward compat', async () => {
      writeCardFile(tempDir, 'orphan.md', makeCardContent({ id: 'orphan', status: 'backlog' }))

      const cards = await sdk.listCards()
      expect(cards.length).toBe(1)
      expect(cards[0].id).toBe('orphan')
    })
  })

  describe('getCard', () => {
    it('should return a card by ID', async () => {
      writeCardFile(tempDir, 'find-me.md', makeCardContent({ id: 'find-me', priority: 'high' }), 'backlog')

      const card = await sdk.getCard('find-me')
      expect(card).not.toBeNull()
      expect(card?.id).toBe('find-me')
      expect(card?.priority).toBe('high')
    })

    it('should return null for non-existent card', async () => {
      const card = await sdk.getCard('ghost')
      expect(card).toBeNull()
    })
  })

  describe('createCard', () => {
    it('should create a card file on disk', async () => {
      const card = await sdk.createCard({
        content: '# New Card\n\nSome description',
        status: 'todo',
        priority: 'high',
        labels: ['frontend']
      })

      expect(card.status).toBe('todo')
      expect(card.priority).toBe('high')
      expect(card.labels).toEqual(['frontend'])
      expect(fs.existsSync(card.filePath)).toBe(true)

      const onDisk = fs.readFileSync(card.filePath, 'utf-8')
      expect(onDisk).toContain('status: "todo"')
      expect(onDisk).toContain('# New Card')
    })

    it('should use defaults for optional fields', async () => {
      const card = await sdk.createCard({ content: '# Default Card' })
      expect(card.status).toBe('backlog')
      expect(card.priority).toBe('medium')
      expect(card.assignee).toBeNull()
      expect(card.labels).toEqual([])
    })

    it('should place cards in their status subfolder', async () => {
      const card = await sdk.createCard({
        content: '# Todo Card',
        status: 'todo'
      })
      expect(card.filePath).toContain('/todo/')
    })

    it('should place done cards in done/ subfolder', async () => {
      const card = await sdk.createCard({
        content: '# Done Card',
        status: 'done'
      })
      expect(card.filePath).toContain('/done/')
      expect(card.completedAt).not.toBeNull()
    })

    it('should assign incremental order within a column', async () => {
      const c1 = await sdk.createCard({ content: '# First', status: 'todo' })
      const c2 = await sdk.createCard({ content: '# Second', status: 'todo' })
      expect(c2.order > c1.order).toBe(true)
    })
  })

  describe('updateCard', () => {
    it('should update fields and persist', async () => {
      writeCardFile(tempDir, 'update-me.md', makeCardContent({ id: 'update-me', priority: 'low' }), 'backlog')

      const updated = await sdk.updateCard('update-me', {
        priority: 'critical',
        assignee: 'alice',
        labels: ['urgent']
      })

      expect(updated.priority).toBe('critical')
      expect(updated.assignee).toBe('alice')
      expect(updated.labels).toEqual(['urgent'])

      const onDisk = fs.readFileSync(updated.filePath, 'utf-8')
      expect(onDisk).toContain('priority: "critical"')
      expect(onDisk).toContain('assignee: "alice"')
    })

    it('should move file to done/ when status changes to done', async () => {
      writeCardFile(tempDir, 'finish-me.md', makeCardContent({ id: 'finish-me', status: 'review' }), 'review')

      const updated = await sdk.updateCard('finish-me', { status: 'done' })
      expect(updated.completedAt).not.toBeNull()
      expect(updated.filePath).toContain('/done/')
      expect(fs.existsSync(updated.filePath)).toBe(true)
    })

    it('should move file between status folders on any status change', async () => {
      writeCardFile(tempDir, 'move-status.md', makeCardContent({ id: 'move-status', status: 'backlog' }), 'backlog')

      const updated = await sdk.updateCard('move-status', { status: 'in-progress' })
      expect(updated.filePath).toContain('/in-progress/')
      expect(fs.existsSync(updated.filePath)).toBe(true)
      expect(fs.existsSync(path.join(tempDir, 'backlog', 'move-status.md'))).toBe(false)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.updateCard('ghost', { priority: 'high' })).rejects.toThrow('Card not found')
    })
  })

  describe('moveCard', () => {
    it('should change status and move file to new folder', async () => {
      writeCardFile(tempDir, 'move-me.md', makeCardContent({ id: 'move-me', status: 'backlog' }), 'backlog')

      const moved = await sdk.moveCard('move-me', 'in-progress')
      expect(moved.status).toBe('in-progress')
      expect(moved.filePath).toContain('/in-progress/')
      expect(fs.existsSync(moved.filePath)).toBe(true)
    })

    it('should handle done boundary crossing', async () => {
      writeCardFile(tempDir, 'to-done.md', makeCardContent({ id: 'to-done', status: 'review' }), 'review')

      const moved = await sdk.moveCard('to-done', 'done')
      expect(moved.completedAt).not.toBeNull()
      expect(moved.filePath).toContain('/done/')
    })

    it('should insert at specified position', async () => {
      writeCardFile(tempDir, 'a.md', makeCardContent({ id: 'a', status: 'todo', order: 'a0' }), 'todo')
      writeCardFile(tempDir, 'c.md', makeCardContent({ id: 'c', status: 'todo', order: 'a2' }), 'todo')
      writeCardFile(tempDir, 'new.md', makeCardContent({ id: 'new', status: 'backlog', order: 'a0' }), 'backlog')

      const moved = await sdk.moveCard('new', 'todo', 1)
      expect(moved.order > 'a0').toBe(true)
      expect(moved.order < 'a2').toBe(true)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.moveCard('ghost', 'todo')).rejects.toThrow('Card not found')
    })
  })

  describe('deleteCard', () => {
    it('should remove the file from disk', async () => {
      writeCardFile(tempDir, 'delete-me.md', makeCardContent({ id: 'delete-me' }), 'backlog')
      const filePath = path.join(tempDir, 'backlog', 'delete-me.md')
      expect(fs.existsSync(filePath)).toBe(true)

      await sdk.deleteCard('delete-me')
      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.deleteCard('ghost')).rejects.toThrow('Card not found')
    })
  })

  describe('getCardsByStatus', () => {
    it('should filter cards by status', async () => {
      writeCardFile(tempDir, 'todo1.md', makeCardContent({ id: 'todo1', status: 'todo', order: 'a0' }), 'todo')
      writeCardFile(tempDir, 'todo2.md', makeCardContent({ id: 'todo2', status: 'todo', order: 'a1' }), 'todo')
      writeCardFile(tempDir, 'backlog1.md', makeCardContent({ id: 'backlog1', status: 'backlog', order: 'a0' }), 'backlog')

      const todoCards = await sdk.getCardsByStatus('todo')
      expect(todoCards.length).toBe(2)
      expect(todoCards.every(c => c.status === 'todo')).toBe(true)
    })
  })

  describe('getUniqueAssignees', () => {
    it('should return sorted unique assignees', async () => {
      writeCardFile(tempDir, 'c1.md', makeCardContent({ id: 'c1', assignee: 'bob', order: 'a0' }), 'backlog')
      writeCardFile(tempDir, 'c2.md', makeCardContent({ id: 'c2', assignee: 'alice', order: 'a1' }), 'backlog')
      writeCardFile(tempDir, 'c3.md', makeCardContent({ id: 'c3', assignee: 'bob', order: 'a2' }), 'backlog')

      const assignees = await sdk.getUniqueAssignees()
      expect(assignees).toEqual(['alice', 'bob'])
    })
  })

  describe('getUniqueLabels', () => {
    it('should return sorted unique labels', async () => {
      writeCardFile(tempDir, 'c1.md', makeCardContent({ id: 'c1', labels: ['ui', 'frontend'], order: 'a0' }), 'backlog')
      writeCardFile(tempDir, 'c2.md', makeCardContent({ id: 'c2', labels: ['backend', 'ui'], order: 'a1' }), 'backlog')

      const labels = await sdk.getUniqueLabels()
      expect(labels).toEqual(['backend', 'frontend', 'ui'])
    })
  })

  describe('addAttachment', () => {
    it('should copy file and add to attachments', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')

      // Create a source file to attach
      const srcFile = path.join(os.tmpdir(), 'test-attach.txt')
      fs.writeFileSync(srcFile, 'hello', 'utf-8')

      const updated = await sdk.addAttachment('card', srcFile)
      expect(updated.attachments).toContain('test-attach.txt')

      // Verify file was copied to the status subfolder
      const destPath = path.join(tempDir, 'backlog', 'test-attach.txt')
      expect(fs.existsSync(destPath)).toBe(true)

      fs.unlinkSync(srcFile)
    })

    it('should not duplicate attachment if already present', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')
      const srcFile = path.join(os.tmpdir(), 'dup.txt')
      fs.writeFileSync(srcFile, 'data', 'utf-8')

      await sdk.addAttachment('card', srcFile)
      const updated = await sdk.addAttachment('card', srcFile)
      expect(updated.attachments.filter(a => a === 'dup.txt').length).toBe(1)

      fs.unlinkSync(srcFile)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.addAttachment('ghost', '/tmp/x.txt')).rejects.toThrow('Card not found')
    })
  })

  describe('removeAttachment', () => {
    it('should remove attachment from card metadata', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')
      const srcFile = path.join(os.tmpdir(), 'rm-me.txt')
      fs.writeFileSync(srcFile, 'data', 'utf-8')

      await sdk.addAttachment('card', srcFile)
      const updated = await sdk.removeAttachment('card', 'rm-me.txt')
      expect(updated.attachments).not.toContain('rm-me.txt')

      fs.unlinkSync(srcFile)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.removeAttachment('ghost', 'x.txt')).rejects.toThrow('Card not found')
    })
  })

  describe('listAttachments', () => {
    it('should return attachments for a card', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card' }), 'backlog')
      const srcFile = path.join(os.tmpdir(), 'att.txt')
      fs.writeFileSync(srcFile, 'data', 'utf-8')

      await sdk.addAttachment('card', srcFile)
      const attachments = await sdk.listAttachments('card')
      expect(attachments).toEqual(['att.txt'])

      fs.unlinkSync(srcFile)
    })

    it('should throw for non-existent card', async () => {
      await expect(sdk.listAttachments('ghost')).rejects.toThrow('Card not found')
    })
  })

  describe('listColumns', () => {
    it('should return default columns when no .kanban.json exists', () => {
      const columns = sdk.listColumns()
      expect(columns.length).toBe(5)
      expect(columns[0].id).toBe('backlog')
      expect(columns[4].id).toBe('done')
    })

    it('should return custom columns from .kanban.json', async () => {
      const config = {
        featuresDirectory: '.kanban',
        columns: [
          { id: 'new', name: 'New', color: '#ff0000' },
          { id: 'wip', name: 'WIP', color: '#00ff00' },
        ]
      }
      fs.writeFileSync(path.join(workspaceDir, '.kanban.json'), JSON.stringify(config), 'utf-8')

      const columns = sdk.listColumns()
      expect(columns.length).toBe(2)
      expect(columns[0].id).toBe('new')
      expect(columns[1].id).toBe('wip')
    })
  })

  describe('addColumn', () => {
    it('should add a column and persist to .kanban.json', () => {
      const columns = sdk.addColumn({ id: 'testing', name: 'Testing', color: '#ff9900' })
      // Default 5 + 1 new
      expect(columns.length).toBe(6)
      expect(columns[5].id).toBe('testing')

      // Verify persisted
      const raw = fs.readFileSync(path.join(workspaceDir, '.kanban.json'), 'utf-8')
      const config = JSON.parse(raw)
      expect(config.columns.length).toBe(6)
    })

    it('should throw if column ID already exists', () => {
      expect(() => sdk.addColumn({ id: 'backlog', name: 'Backlog 2', color: '#000' }))
        .toThrow('Column already exists: backlog')
    })
  })

  describe('updateColumn', () => {
    it('should update column name and color', () => {
      const columns = sdk.updateColumn('backlog', { name: 'Inbox', color: '#123456' })
      const updated = columns.find(c => c.id === 'backlog')
      expect(updated?.name).toBe('Inbox')
      expect(updated?.color).toBe('#123456')
    })

    it('should throw for non-existent column', () => {
      expect(() => sdk.updateColumn('ghost', { name: 'X' })).toThrow('Column not found')
    })
  })

  describe('removeColumn', () => {
    it('should remove an empty column', async () => {
      // Add a custom column first, then remove it
      sdk.addColumn({ id: 'staging', name: 'Staging', color: '#aaa' })
      const columns = await sdk.removeColumn('staging')
      expect(columns.find(c => c.id === 'staging')).toBeUndefined()
    })

    it('should throw if cards exist in the column', async () => {
      writeCardFile(tempDir, 'card.md', makeCardContent({ id: 'card', status: 'backlog' }), 'backlog')
      await expect(sdk.removeColumn('backlog')).rejects.toThrow('Cannot remove column')
    })

    it('should throw for non-existent column', async () => {
      await expect(sdk.removeColumn('ghost')).rejects.toThrow('Column not found')
    })
  })

  describe('reorderColumns', () => {
    it('should reorder columns', () => {
      const columns = sdk.reorderColumns(['done', 'review', 'in-progress', 'todo', 'backlog'])
      expect(columns[0].id).toBe('done')
      expect(columns[4].id).toBe('backlog')
    })

    it('should throw if a column ID is missing', () => {
      expect(() => sdk.reorderColumns(['done', 'review'])).toThrow('Must include all column IDs')
    })

    it('should throw for unknown column ID', () => {
      expect(() => sdk.reorderColumns(['done', 'review', 'in-progress', 'todo', 'unknown']))
        .toThrow('Column not found')
    })
  })

  describe('comments', () => {
    it('should add a comment to a card', async () => {
      const card = await sdk.createCard({ content: '# Comment Test' })
      expect(card.comments).toEqual([])

      const updated = await sdk.addComment(card.id, 'alice', 'Hello world')
      expect(updated.comments).toHaveLength(1)
      expect(updated.comments[0].id).toBe('c1')
      expect(updated.comments[0].author).toBe('alice')
      expect(updated.comments[0].content).toBe('Hello world')
    })

    it('should auto-increment comment IDs', async () => {
      const card = await sdk.createCard({ content: '# ID Test' })
      await sdk.addComment(card.id, 'alice', 'First')
      const updated = await sdk.addComment(card.id, 'bob', 'Second')

      expect(updated.comments).toHaveLength(2)
      expect(updated.comments[0].id).toBe('c1')
      expect(updated.comments[1].id).toBe('c2')
    })

    it('should list comments on a card', async () => {
      const card = await sdk.createCard({ content: '# List Comments' })
      await sdk.addComment(card.id, 'alice', 'Comment 1')
      await sdk.addComment(card.id, 'bob', 'Comment 2')

      const comments = await sdk.listComments(card.id)
      expect(comments).toHaveLength(2)
      expect(comments[0].author).toBe('alice')
      expect(comments[1].author).toBe('bob')
    })

    it('should update a comment', async () => {
      const card = await sdk.createCard({ content: '# Update Comment' })
      await sdk.addComment(card.id, 'alice', 'Original')

      const updated = await sdk.updateComment(card.id, 'c1', 'Edited content')
      expect(updated.comments[0].content).toBe('Edited content')

      // Verify persisted
      const reloaded = await sdk.getCard(card.id)
      expect(reloaded?.comments[0].content).toBe('Edited content')
    })

    it('should delete a comment', async () => {
      const card = await sdk.createCard({ content: '# Delete Comment' })
      await sdk.addComment(card.id, 'alice', 'To be deleted')
      await sdk.addComment(card.id, 'bob', 'To keep')

      const updated = await sdk.deleteComment(card.id, 'c1')
      expect(updated.comments).toHaveLength(1)
      expect(updated.comments[0].id).toBe('c2')
      expect(updated.comments[0].author).toBe('bob')
    })

    it('should throw when adding comment to non-existent card', async () => {
      await expect(sdk.addComment('ghost', 'alice', 'Hello')).rejects.toThrow('Card not found')
    })

    it('should throw when updating non-existent comment', async () => {
      const card = await sdk.createCard({ content: '# No Such Comment' })
      await expect(sdk.updateComment(card.id, 'c99', 'Nope')).rejects.toThrow('Comment not found')
    })

    it('should preserve comments through card updates', async () => {
      const card = await sdk.createCard({ content: '# Preserve Comments' })
      await sdk.addComment(card.id, 'alice', 'Persistent comment')

      const updated = await sdk.updateCard(card.id, { priority: 'high' })
      expect(updated.comments).toHaveLength(1)
      expect(updated.comments[0].content).toBe('Persistent comment')
    })
  })
})
