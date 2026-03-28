/**
 * Unit tests — attachment tools.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ListAttachmentsTool,
  AddAttachmentTool,
  RemoveAttachmentTool,
  createAttachmentTools,
} from 'kl-langchain-tools'
import { createMockSDK } from '../helpers'

describe('Attachment tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createAttachmentTools returns 3 tools', () => {
    expect(createAttachmentTools(sdk)).toHaveLength(3)
  })

  describe('ListAttachmentsTool', () => {
    it('lists attachments', async () => {
      const tool = new ListAttachmentsTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1' }))
      expect(result).toEqual(['screenshot.png'])
      expect(sdk.listAttachments).toHaveBeenCalledWith('1', undefined)
    })

    it('passes boardId', async () => {
      const tool = new ListAttachmentsTool(sdk)
      await tool.invoke({ cardId: '1', boardId: 'b1' })
      expect(sdk.listAttachments).toHaveBeenCalledWith('1', 'b1')
    })
  })

  describe('AddAttachmentTool', () => {
    it('attaches a file', async () => {
      const tool = new AddAttachmentTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', sourcePath: '/tmp/file.txt' }))
      expect(result.filename).toBe('file.txt')
      expect(sdk.addAttachment).toHaveBeenCalledWith('1', '/tmp/file.txt', undefined)
    })
  })

  describe('RemoveAttachmentTool', () => {
    it('removes an attachment', async () => {
      const tool = new RemoveAttachmentTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', attachment: 'screenshot.png' }))
      expect(result.removed).toBe(true)
      expect(result.attachment).toBe('screenshot.png')
      expect(sdk.removeAttachment).toHaveBeenCalledWith('1', 'screenshot.png', undefined)
    })
  })
})
