import * as path from 'path'

import { configPath, readConfig } from '../shared/config'
import { resolveKanbanDir, resolveWorkspaceRoot } from '../sdk/fileUtils'
import { startServer } from './server'

export function parseArgs(args: string[]): { dir?: string; port?: number; noBrowser: boolean; config?: string } {
  let dir: string | undefined
  let port: number | undefined
  let noBrowser = false
  let config: string | undefined

  for (let i = 0; i < args.length; i += 1) {
    switch (args[i]) {
      case '--dir':
      case '-d':
        dir = args[++i]
        break
      case '--config':
        config = args[++i]
        break
      case '--port':
      case '-p':
        port = parseInt(args[++i], 10)
        break
      case '--no-browser':
        noBrowser = true
        break
      case '--help':
      case '-h':
        console.log(`
Usage: kanban-md [options]

Options:
  -d, --dir <path>    Kanban directory (default: .kanban)
  --config <path>     Path to the workspace .kanban.json file
  -p, --port <number> Port to listen on (default: .kanban.json port or 3000)
  --no-browser        Don't open browser automatically
  -h, --help          Show this help message

REST API available at http://localhost:<port>/api
  Tasks:    GET/POST /api/tasks, GET/PUT/DELETE /api/tasks/:id
  Move:     PATCH /api/tasks/:id/move
  Columns:  GET/POST /api/columns, PUT/DELETE /api/columns/:id
  Settings: GET/PUT /api/settings
`)
        process.exit(0)
    }
  }

  return { dir, port, noBrowser, config }
}

export function main(args = process.argv.slice(2)) {
  const parsed = parseArgs(args)
  const workspaceRoot = parsed.config
    ? resolveWorkspaceRoot(process.cwd(), parsed.config)
    : parsed.dir
      ? path.dirname(path.resolve(parsed.dir))
      : resolveWorkspaceRoot(process.cwd())
  const dir = parsed.dir ? path.resolve(parsed.dir) : resolveKanbanDir(process.cwd(), parsed.config)
  const configPort = readConfig(workspaceRoot).port
  const resolvedConfigFilePath = parsed.config ? path.resolve(parsed.config) : configPath(workspaceRoot)
  const port = parsed.port ?? configPort
  const { noBrowser } = parsed

  const server = startServer(dir, port, undefined, resolvedConfigFilePath)

  if (!noBrowser) {
    server.on('listening', async () => {
      try {
        const open = (await import('open')).default
        void open(`http://localhost:${port}`)
      } catch {
        // open is optional, just print the URL
      }
    })
  }

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    server.close()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    server.close()
    process.exit(0)
  })

  return server
}
