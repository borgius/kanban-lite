import * as path from 'path'
import * as fs from 'fs/promises'
import { KanbanSDK } from '../../sdk/KanbanSDK'
import { bold, cyan, dim, green, red } from '../output'
import {
  getBoardId,
  getConfigFilePath,
  handleAuthError,
  parseJsonArrayFlag,
  parseJsonObjectFlag,
  resolveCardId,
  resolveKanbanDirForFlags,
  resolveWorkspaceRootForFlags,
  runWithCliAuth,
  type Flags,
} from '../shared'

export async function cmdAttach(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const cardId = positional[1]
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'rm' && subcommand !== 'remove') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId, flags)
    const attachments = await runWithCliAuth(sdk, flags, () => sdk.listAttachments(resolvedId, boardId))
    if (flags.json) {
      console.log(JSON.stringify(attachments, null, 2))
    } else if (attachments.length === 0) {
      console.log(dim('  No attachments.'))
    } else {
      for (const a of attachments) console.log(`  ${a}`)
    }
    return
  }

  switch (subcommand) {
    case 'list': {
      if (!cardId) {
        console.error(red('Usage: kl attach list <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const attachments = await runWithCliAuth(sdk, flags, () => sdk.listAttachments(resolvedId, boardId))
      if (flags.json) {
        console.log(JSON.stringify(attachments, null, 2))
      } else if (attachments.length === 0) {
        console.log(dim('  No attachments.'))
      } else {
        for (const a of attachments) console.log(`  ${a}`)
      }
      break
    }
    case 'add': {
      if (!cardId) {
        console.error(red('Usage: kl attach add <card-id> <file-path>'))
        process.exit(1)
      }
      const filePath = positional[2]
      if (!filePath) {
        console.error(red('Usage: kl attach add <card-id> <file-path>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.addAttachment(resolvedId, filePath, boardId))
      console.log(green(`Attached to ${updated.id}: ${path.basename(filePath)}`))
      break
    }
    case 'remove':
    case 'rm': {
      if (!cardId) {
        console.error(red('Usage: kl attach remove <card-id> <filename>'))
        process.exit(1)
      }
      const filename = positional[2]
      if (!filename) {
        console.error(red('Usage: kl attach remove <card-id> <filename>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const updated = await runWithCliAuth(sdk, flags, () => sdk.removeAttachment(resolvedId, filename, boardId))
      console.log(green(`Removed from ${updated.id}: ${filename}`))
      break
    }
  }
}

// --- Comment Commands ---

export async function cmdComment(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'edit' && subcommand !== 'remove' && subcommand !== 'rm' && subcommand !== 'stream') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId, flags)
    const comments = await runWithCliAuth(sdk, flags, () => sdk.listComments(resolvedId, boardId))
    if (flags.json) {
      console.log(JSON.stringify(comments, null, 2))
    } else if (comments.length === 0) {
      console.log(dim('  No comments.'))
    } else {
      for (const c of comments) {
        console.log(`  ${bold(c.id)}  ${cyan(c.author)}  ${dim(c.created)}`)
        console.log(`    ${c.content.split('\n').join('\n    ')}`)
        console.log()
      }
    }
    return
  }

  const cardId = positional[1]

  switch (subcommand) {
    case 'list': {
      if (!cardId) {
        console.error(red('Usage: kl comment list <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const comments = await runWithCliAuth(sdk, flags, () => sdk.listComments(resolvedId, boardId))
      if (flags.json) {
        console.log(JSON.stringify(comments, null, 2))
      } else if (comments.length === 0) {
        console.log(dim('  No comments.'))
      } else {
        for (const c of comments) {
          console.log(`  ${bold(c.id)}  ${cyan(c.author)}  ${dim(c.created)}`)
          console.log(`    ${c.content.split('\n').join('\n    ')}`)
          console.log()
        }
      }
      break
    }
    case 'add': {
      if (!cardId) {
        console.error(red('Usage: kl comment add <card-id> --author <name> --body <text>'))
        process.exit(1)
      }
      const author = typeof flags.author === 'string' ? flags.author : ''
      const body = typeof flags.body === 'string' ? flags.body : ''
      if (!author) {
        console.error(red('Error: --author is required'))
        process.exit(1)
      }
      if (!body) {
        console.error(red('Error: --body is required'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const card = await runWithCliAuth(sdk, flags, () => sdk.addComment(resolvedId, author, body, boardId))
      const added = card.comments[card.comments.length - 1]
      if (flags.json) {
        console.log(JSON.stringify(added, null, 2))
      } else {
        console.log(green(`Added comment ${added.id} to card ${resolvedId}`))
      }
      break
    }
    case 'edit': {
      if (!cardId) {
        console.error(red('Usage: kl comment edit <card-id> <comment-id> --body <text>'))
        process.exit(1)
      }
      const commentId = positional[2]
      if (!commentId) {
        console.error(red('Usage: kl comment edit <card-id> <comment-id> --body <text>'))
        process.exit(1)
      }
      const body = typeof flags.body === 'string' ? flags.body : ''
      if (!body) {
        console.error(red('Error: --body is required'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.updateComment(resolvedId, commentId, body, boardId))
      if (flags.json) {
        const comments = await runWithCliAuth(sdk, flags, () => sdk.listComments(resolvedId, boardId))
        const updated = comments.find(c => c.id === commentId)
        console.log(JSON.stringify(updated, null, 2))
      } else {
        console.log(green(`Updated comment ${commentId}`))
      }
      break
    }
    case 'remove':
    case 'rm': {
      if (!cardId) {
        console.error(red('Usage: kl comment remove <card-id> <comment-id>'))
        process.exit(1)
      }
      const commentId = positional[2]
      if (!commentId) {
        console.error(red('Usage: kl comment remove <card-id> <comment-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.deleteComment(resolvedId, commentId, boardId))
      console.log(green(`Deleted comment ${commentId}`))
      break
    }
    case 'stream': {
      // Reads text from stdin and streams it as a comment in real-time.
      // Useful for piping LLM output: `llm-cli generate | kl comment stream <card-id> --author agent`
      if (!cardId) {
        console.error(red('Usage: kl comment stream <card-id> --author <name>'))
        process.exit(1)
      }
      const author = typeof flags.author === 'string' ? flags.author : ''
      if (!author) {
        console.error(red('Error: --author is required'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      async function* stdinStream(): AsyncIterable<string> {
        process.stdin.setEncoding('utf8')
        for await (const chunk of process.stdin) {
          if (!flags.json) process.stderr.write('.')
          yield chunk as string
        }
      }
      if (!flags.json) process.stderr.write('Streaming comment')
      const card = await runWithCliAuth(sdk, flags, () => sdk.streamComment(resolvedId, author, stdinStream(), { boardId }))
      if (!flags.json) process.stderr.write('\n')
      const added = card.comments?.[card.comments.length - 1]
      if (flags.json) {
        console.log(JSON.stringify(added, null, 2))
      } else {
        console.log(green(`Streamed comment ${added?.id ?? '?'} to card ${resolvedId}`))
      }
      break
    }
  }
}

// --- Log Commands ---

export async function cmdLog(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  if (subcommand !== 'list' && subcommand !== 'add' && subcommand !== 'clear') {
    // If first positional looks like a card ID, treat it as "list <cardId>"
    const resolvedId = await resolveCardId(sdk, subcommand, boardId, flags)
    const logs = await runWithCliAuth(sdk, flags, () => sdk.listLogs(resolvedId, boardId))
    if (flags.json) {
      console.log(JSON.stringify(logs, null, 2))
    } else if (logs.length === 0) {
      console.log(dim('  No logs.'))
    } else {
      for (const entry of logs) {
        const objStr = entry.object ? `  ${dim(JSON.stringify(entry.object))}` : ''
        console.log(`  ${dim(entry.timestamp)}  ${cyan(`[${entry.source}]`)}  ${entry.text}${objStr}`)
      }
    }
    return
  }

  const cardId = positional[1]

  switch (subcommand) {
    case 'list': {
      if (!cardId) {
        console.error(red('Usage: kl log list <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const logs = await runWithCliAuth(sdk, flags, () => sdk.listLogs(resolvedId, boardId))
      if (flags.json) {
        console.log(JSON.stringify(logs, null, 2))
      } else if (logs.length === 0) {
        console.log(dim('  No logs.'))
      } else {
        for (const entry of logs) {
          const objStr = entry.object ? `  ${dim(JSON.stringify(entry.object))}` : ''
          console.log(`  ${dim(entry.timestamp)}  ${cyan(`[${entry.source}]`)}  ${entry.text}${objStr}`)
        }
      }
      break
    }
    case 'add': {
      if (!cardId) {
        console.error(red('Usage: kl log add <card-id> --text <message> [--source <src>] [--object <json>]'))
        process.exit(1)
      }
      const text = typeof flags.text === 'string' ? flags.text : (typeof flags.body === 'string' ? flags.body : '')
      if (!text) {
        console.error(red('Error: --text is required'))
        process.exit(1)
      }
      const source = typeof flags.source === 'string' ? flags.source : undefined
      let obj: Record<string, unknown> | undefined
      if (typeof flags.object === 'string') {
        try {
          obj = JSON.parse(flags.object)
        } catch {
          console.error(red('Error: --object must be valid JSON'))
          process.exit(1)
        }
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      const entry = await runWithCliAuth(sdk, flags, () => sdk.addLog(resolvedId, text, { source, object: obj }, boardId))
      if (flags.json) {
        console.log(JSON.stringify(entry, null, 2))
      } else {
        console.log(green(`Added log to card ${resolvedId}`))
      }
      break
    }
    case 'clear': {
      if (!cardId) {
        console.error(red('Usage: kl log clear <card-id>'))
        process.exit(1)
      }
      const resolvedId = await resolveCardId(sdk, cardId, boardId, flags)
      await runWithCliAuth(sdk, flags, () => sdk.clearLogs(resolvedId, boardId))
      console.log(green(`Cleared logs for card ${resolvedId}`))
      break
    }
  }
}

// --- Board Log Commands ---

export async function cmdBoardLog(sdk: KanbanSDK, positional: string[], flags: Flags): Promise<void> {
  const subcommand = positional[0] || 'list'
  const boardId = getBoardId(flags)

  switch (subcommand) {
    case 'list': {
      const logs = await sdk.listBoardLogs(boardId)
      if (flags.json) {
        console.log(JSON.stringify(logs, null, 2))
      } else if (logs.length === 0) {
        console.log(dim('  No board logs.'))
      } else {
        for (const entry of logs) {
          const objStr = entry.object ? `  ${dim(JSON.stringify(entry.object))}` : ''
          console.log(`  ${dim(entry.timestamp)}  ${cyan(`[${entry.source}]`)}  ${entry.text}${objStr}`)
        }
      }
      break
    }
    case 'add': {
      const text = typeof flags.text === 'string' ? flags.text : (typeof flags.body === 'string' ? flags.body : '')
      if (!text) {
        console.error(red('Error: --text is required'))
        process.exit(1)
      }
      const source = typeof flags.source === 'string' ? flags.source : undefined
      let obj: Record<string, unknown> | undefined
      if (typeof flags.object === 'string') {
        try {
          obj = JSON.parse(flags.object)
        } catch {
          console.error(red('Error: --object must be valid JSON'))
          process.exit(1)
        }
      }
      const entry = await runWithCliAuth(sdk, flags, () => sdk.addBoardLog(text, { source, object: obj }, boardId))
      if (flags.json) {
        console.log(JSON.stringify(entry, null, 2))
      } else {
        console.log(green('Added board log entry'))
      }
      break
    }
    case 'clear': {
      await runWithCliAuth(sdk, flags, () => sdk.clearBoardLogs(boardId))
      console.log(green('Cleared board logs'))
      break
    }
    default: {
      console.error(red(`Unknown subcommand: ${subcommand}`))
      process.exit(1)
    }
  }
}

// --- Column Commands ---

