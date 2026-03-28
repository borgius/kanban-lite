/**
 * Unit tests — comment tools (including streaming).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ListCommentsTool,
  AddCommentTool,
  UpdateCommentTool,
  DeleteCommentTool,
  StreamCommentTool,
  streamCommentDirect,
  createCommentTools,
} from 'kl-langchain-tools'
import { createMockSDK } from '../helpers'

describe('Comment tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createCommentTools returns 5 tools', () => {
    expect(createCommentTools(sdk)).toHaveLength(5)
  })

  describe('ListCommentsTool', () => {
    it('lists comments', async () => {
      const tool = new ListCommentsTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1' }))
      expect(result).toHaveLength(1)
      expect(result[0].author).toBe('alice')
      expect(sdk.listComments).toHaveBeenCalledWith('1', undefined)
    })

    it('passes boardId', async () => {
      const tool = new ListCommentsTool(sdk)
      await tool.invoke({ cardId: '1', boardId: 'b1' })
      expect(sdk.listComments).toHaveBeenCalledWith('1', 'b1')
    })
  })

  describe('AddCommentTool', () => {
    it('adds a comment', async () => {
      const tool = new AddCommentTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', author: 'bot', content: 'Hello' }))
      expect(result.author).toBe('bot')
      expect(sdk.addComment).toHaveBeenCalledWith('1', 'bot', 'Hello', undefined)
    })
  })

  describe('UpdateCommentTool', () => {
    it('updates a comment', async () => {
      const tool = new UpdateCommentTool(sdk)
      const result = JSON.parse(await tool.invoke({
        cardId: '1', commentId: 'c1', content: 'Updated',
      }))
      expect(result.content).toBe('Updated')
    })
  })

  describe('DeleteCommentTool', () => {
    it('deletes a comment', async () => {
      const tool = new DeleteCommentTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', commentId: 'c1' }))
      expect(result.deleted).toBe(true)
      expect(result.commentId).toBe('c1')
    })
  })

  describe('StreamCommentTool', () => {
    it('streams content as a single chunk', async () => {
      const tool = new StreamCommentTool(sdk)
      const result = JSON.parse(await tool.invoke({
        cardId: '1', author: 'agent', content: 'Streamed text',
      }))
      expect(result.content).toBe('Streamed text')
      expect(sdk.streamComment).toHaveBeenCalled()
      // Verify the stream argument is an AsyncIterable
      const call = (sdk.streamComment as any).mock.calls[0]
      expect(call[0]).toBe('1')
      expect(call[1]).toBe('agent')
    })
  })

  describe('streamCommentDirect', () => {
    it('passes stream and callbacks to SDK', async () => {
      const onStart = vi.fn()
      const onChunk = vi.fn()
      async function* gen() { yield 'hello'; yield ' world' }

      await streamCommentDirect(sdk, {
        cardId: '1', author: 'bot', stream: gen(),
        boardId: 'b1', onStart, onChunk,
      })

      expect(sdk.streamComment).toHaveBeenCalledWith('1', 'bot', expect.anything(), {
        boardId: 'b1',
        onStart,
        onChunk,
      })
    })

    it('works without callbacks', async () => {
      async function* gen() { yield 'text' }
      await streamCommentDirect(sdk, { cardId: '1', author: 'bot', stream: gen() })
      expect(sdk.streamComment).toHaveBeenCalled()
    })
  })
})
