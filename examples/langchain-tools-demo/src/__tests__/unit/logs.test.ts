/**
 * Unit tests — log tools.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ListLogsTool,
  AddLogTool,
  ClearLogsTool,
  ListBoardLogsTool,
  AddBoardLogTool,
  createLogTools,
} from 'kl-adapter-langchain'
import { createMockSDK } from '../helpers'

describe('Log tools (unit)', () => {
  let sdk: ReturnType<typeof createMockSDK>

  beforeEach(() => { sdk = createMockSDK() })

  it('createLogTools returns 5 tools', () => {
    expect(createLogTools(sdk)).toHaveLength(5)
  })

  describe('ListLogsTool', () => {
    it('lists card logs', async () => {
      const tool = new ListLogsTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1' }))
      expect(result).toHaveLength(1)
      expect(result[0].text).toBe('Build passed')
      expect(sdk.listLogs).toHaveBeenCalledWith('1', undefined)
    })

    it('passes boardId', async () => {
      const tool = new ListLogsTool(sdk)
      await tool.invoke({ cardId: '1', boardId: 'b1' })
      expect(sdk.listLogs).toHaveBeenCalledWith('1', 'b1')
    })
  })

  describe('AddLogTool', () => {
    it('adds a log with text only', async () => {
      const tool = new AddLogTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1', text: 'Deployed' }))
      expect(result.text).toBe('Deployed')
      expect(sdk.addLog).toHaveBeenCalledWith('1', 'Deployed', {}, undefined)
    })

    it('adds a log with source and object', async () => {
      const tool = new AddLogTool(sdk)
      await tool.invoke({
        cardId: '1', text: 'Deploy', source: 'ci',
        object: { version: '1.0' }, boardId: 'b1',
      })
      expect(sdk.addLog).toHaveBeenCalledWith(
        '1', 'Deploy',
        { source: 'ci', object: { version: '1.0' } },
        'b1',
      )
    })
  })

  describe('ClearLogsTool', () => {
    it('clears logs', async () => {
      const tool = new ClearLogsTool(sdk)
      const result = JSON.parse(await tool.invoke({ cardId: '1' }))
      expect(result.cleared).toBe(true)
      expect(sdk.clearLogs).toHaveBeenCalledWith('1', undefined)
    })
  })

  describe('ListBoardLogsTool', () => {
    it('lists board logs', async () => {
      const tool = new ListBoardLogsTool(sdk)
      const result = JSON.parse(await tool.invoke({}))
      expect(Array.isArray(result)).toBe(true)
      expect(sdk.listBoardLogs).toHaveBeenCalledWith(undefined)
    })
  })

  describe('AddBoardLogTool', () => {
    it('adds a board log', async () => {
      const tool = new AddBoardLogTool(sdk)
      const result = JSON.parse(await tool.invoke({ text: 'Sprint started', source: 'system' }))
      expect(result.text).toBe('Sprint started')
      expect(sdk.addBoardLog).toHaveBeenCalledWith('Sprint started', { source: 'system' }, undefined)
    })
  })
})
