import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as http from 'http'
import { loadWebhooks, saveWebhooks, createWebhook, deleteWebhook, fireWebhooks } from '../webhooks'
import type { Webhook } from '../webhooks'

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kanban-webhooks-test-'))
}

describe('Webhooks Module', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = createTempDir()
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  // ── loadWebhooks ──

  describe('loadWebhooks', () => {
    it('should return empty array when no webhooks file exists', () => {
      const webhooks = loadWebhooks(tempDir)
      expect(webhooks).toEqual([])
    })

    it('should return empty array for invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, '.kanban-webhooks.json'), 'not json{', 'utf-8')
      const webhooks = loadWebhooks(tempDir)
      expect(webhooks).toEqual([])
    })

    it('should return empty array for non-array JSON', () => {
      fs.writeFileSync(path.join(tempDir, '.kanban-webhooks.json'), '{"not": "array"}', 'utf-8')
      const webhooks = loadWebhooks(tempDir)
      expect(webhooks).toEqual([])
    })

    it('should load webhooks from file', () => {
      const data: Webhook[] = [
        { id: 'wh_test1', url: 'https://example.com/hook1', events: ['*'], active: true },
        { id: 'wh_test2', url: 'https://example.com/hook2', events: ['task.created'], secret: 'mysecret', active: true }
      ]
      fs.writeFileSync(path.join(tempDir, '.kanban-webhooks.json'), JSON.stringify(data), 'utf-8')

      const webhooks = loadWebhooks(tempDir)
      expect(webhooks.length).toBe(2)
      expect(webhooks[0].id).toBe('wh_test1')
      expect(webhooks[1].secret).toBe('mysecret')
    })
  })

  // ── saveWebhooks ──

  describe('saveWebhooks', () => {
    it('should persist webhooks to file', () => {
      const data: Webhook[] = [
        { id: 'wh_save', url: 'https://example.com/save', events: ['task.created'], active: true }
      ]
      saveWebhooks(tempDir, data)

      const raw = fs.readFileSync(path.join(tempDir, '.kanban-webhooks.json'), 'utf-8')
      const parsed = JSON.parse(raw)
      expect(parsed.length).toBe(1)
      expect(parsed[0].id).toBe('wh_save')
    })

    it('should overwrite existing webhooks', () => {
      const initial: Webhook[] = [
        { id: 'wh_old', url: 'https://old.com', events: ['*'], active: true }
      ]
      saveWebhooks(tempDir, initial)

      const updated: Webhook[] = [
        { id: 'wh_new', url: 'https://new.com', events: ['task.moved'], active: true }
      ]
      saveWebhooks(tempDir, updated)

      const webhooks = loadWebhooks(tempDir)
      expect(webhooks.length).toBe(1)
      expect(webhooks[0].id).toBe('wh_new')
    })
  })

  // ── createWebhook ──

  describe('createWebhook', () => {
    it('should create a webhook with generated ID', () => {
      const webhook = createWebhook(tempDir, {
        url: 'https://example.com/hook',
        events: ['task.created', 'task.moved']
      })

      expect(webhook.id).toMatch(/^wh_[0-9a-f]+$/)
      expect(webhook.url).toBe('https://example.com/hook')
      expect(webhook.events).toEqual(['task.created', 'task.moved'])
      expect(webhook.active).toBe(true)
      expect(webhook.secret).toBeUndefined()
    })

    it('should store secret when provided', () => {
      const webhook = createWebhook(tempDir, {
        url: 'https://example.com/hook',
        events: ['*'],
        secret: 'my-secret-key'
      })

      expect(webhook.secret).toBe('my-secret-key')
    })

    it('should persist to file', () => {
      createWebhook(tempDir, {
        url: 'https://example.com/hook',
        events: ['*']
      })

      const webhooks = loadWebhooks(tempDir)
      expect(webhooks.length).toBe(1)
    })

    it('should append to existing webhooks', () => {
      createWebhook(tempDir, { url: 'https://one.com', events: ['*'] })
      createWebhook(tempDir, { url: 'https://two.com', events: ['*'] })

      const webhooks = loadWebhooks(tempDir)
      expect(webhooks.length).toBe(2)
    })
  })

  // ── deleteWebhook ──

  describe('deleteWebhook', () => {
    it('should remove a webhook by ID', () => {
      const webhook = createWebhook(tempDir, {
        url: 'https://example.com/hook',
        events: ['*']
      })

      const result = deleteWebhook(tempDir, webhook.id)
      expect(result).toBe(true)

      const webhooks = loadWebhooks(tempDir)
      expect(webhooks.length).toBe(0)
    })

    it('should return false for non-existent ID', () => {
      const result = deleteWebhook(tempDir, 'wh_nonexistent')
      expect(result).toBe(false)
    })

    it('should only remove the targeted webhook', () => {
      const wh1 = createWebhook(tempDir, { url: 'https://one.com', events: ['*'] })
      createWebhook(tempDir, { url: 'https://two.com', events: ['*'] })

      deleteWebhook(tempDir, wh1.id)

      const webhooks = loadWebhooks(tempDir)
      expect(webhooks.length).toBe(1)
      expect(webhooks[0].url).toBe('https://two.com')
    })
  })

  // ── fireWebhooks ──

  describe('fireWebhooks', () => {
    it('should POST to matching webhooks', async () => {
      // Create a simple HTTP server to receive the webhook
      let receivedBody = ''
      let receivedHeaders: http.IncomingHttpHeaders = {}
      const receiver = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => body += chunk)
        req.on('end', () => {
          receivedBody = body
          receivedHeaders = req.headers
          res.writeHead(200)
          res.end()
        })
      })

      await new Promise<void>(resolve => receiver.listen(0, resolve))
      const receiverPort = (receiver.address() as { port: number }).port

      try {
        createWebhook(tempDir, {
          url: `http://localhost:${receiverPort}/hook`,
          events: ['task.created']
        })

        fireWebhooks(tempDir, 'task.created', { id: 'test-task', status: 'todo' })

        // Wait for async delivery
        await new Promise(r => setTimeout(r, 500))

        const parsed = JSON.parse(receivedBody)
        expect(parsed.event).toBe('task.created')
        expect(parsed.data.id).toBe('test-task')
        expect(receivedHeaders['x-webhook-event']).toBe('task.created')
        expect(receivedHeaders['content-type']).toBe('application/json')
      } finally {
        await new Promise<void>(resolve => receiver.close(() => resolve()))
      }
    })

    it('should not POST to webhooks that do not match the event', async () => {
      let called = false
      const receiver = http.createServer((_req, res) => {
        called = true
        res.writeHead(200)
        res.end()
      })

      await new Promise<void>(resolve => receiver.listen(0, resolve))
      const receiverPort = (receiver.address() as { port: number }).port

      try {
        createWebhook(tempDir, {
          url: `http://localhost:${receiverPort}/hook`,
          events: ['task.deleted']
        })

        fireWebhooks(tempDir, 'task.created', { id: 'test' })

        await new Promise(r => setTimeout(r, 300))
        expect(called).toBe(false)
      } finally {
        await new Promise<void>(resolve => receiver.close(() => resolve()))
      }
    })

    it('should POST to wildcard webhooks for any event', async () => {
      let receivedBody = ''
      const receiver = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => body += chunk)
        req.on('end', () => {
          receivedBody = body
          res.writeHead(200)
          res.end()
        })
      })

      await new Promise<void>(resolve => receiver.listen(0, resolve))
      const receiverPort = (receiver.address() as { port: number }).port

      try {
        createWebhook(tempDir, {
          url: `http://localhost:${receiverPort}/hook`,
          events: ['*']
        })

        fireWebhooks(tempDir, 'column.deleted', { id: 'test-col' })

        await new Promise(r => setTimeout(r, 500))

        const parsed = JSON.parse(receivedBody)
        expect(parsed.event).toBe('column.deleted')
        expect(parsed.data.id).toBe('test-col')
      } finally {
        await new Promise<void>(resolve => receiver.close(() => resolve()))
      }
    })

    it('should include HMAC signature when secret is configured', async () => {
      let receivedHeaders: http.IncomingHttpHeaders = {}
      let receivedBody = ''
      const receiver = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => body += chunk)
        req.on('end', () => {
          receivedHeaders = req.headers
          receivedBody = body
          res.writeHead(200)
          res.end()
        })
      })

      await new Promise<void>(resolve => receiver.listen(0, resolve))
      const receiverPort = (receiver.address() as { port: number }).port

      try {
        createWebhook(tempDir, {
          url: `http://localhost:${receiverPort}/hook`,
          events: ['*'],
          secret: 'test-secret'
        })

        fireWebhooks(tempDir, 'task.created', { id: 'sig-test' })

        await new Promise(r => setTimeout(r, 500))

        const signature = receivedHeaders['x-webhook-signature'] as string
        expect(signature).toBeDefined()
        expect(signature).toMatch(/^sha256=[0-9a-f]+$/)

        // Verify the signature
        const crypto = await import('crypto')
        const expected = crypto
          .createHmac('sha256', 'test-secret')
          .update(receivedBody)
          .digest('hex')
        expect(signature).toBe(`sha256=${expected}`)
      } finally {
        await new Promise<void>(resolve => receiver.close(() => resolve()))
      }
    })

    it('should not fire inactive webhooks', async () => {
      let called = false
      const receiver = http.createServer((_req, res) => {
        called = true
        res.writeHead(200)
        res.end()
      })

      await new Promise<void>(resolve => receiver.listen(0, resolve))
      const receiverPort = (receiver.address() as { port: number }).port

      try {
        // Create an active webhook then manually mark it inactive
        const wh = createWebhook(tempDir, {
          url: `http://localhost:${receiverPort}/hook`,
          events: ['*']
        })

        const webhooks = loadWebhooks(tempDir)
        webhooks[0].active = false
        saveWebhooks(tempDir, webhooks)

        fireWebhooks(tempDir, 'task.created', { id: wh.id })

        await new Promise(r => setTimeout(r, 300))
        expect(called).toBe(false)
      } finally {
        await new Promise<void>(resolve => receiver.close(() => resolve()))
      }
    })

    it('should handle delivery failure gracefully', () => {
      // Point to a port that is not listening
      createWebhook(tempDir, {
        url: 'http://localhost:1/hook',
        events: ['*']
      })

      // Should not throw
      expect(() => {
        fireWebhooks(tempDir, 'task.created', { id: 'fail-test' })
      }).not.toThrow()
    })
  })
})
