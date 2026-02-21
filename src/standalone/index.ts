import { startServer } from './server'

function parseArgs(args: string[]): { dir: string; port: number; noBrowser: boolean } {
  let dir = '.kanban'
  let port = 3000
  let noBrowser = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--dir':
      case '-d':
        dir = args[++i]
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
  -d, --dir <path>    Features directory (default: .kanban)
  -p, --port <number> Port to listen on (default: 3000)
  --no-browser        Don't open browser automatically
  -h, --help          Show this help message

REST API available at http://localhost:<port>/api
  Tasks:    GET/POST /api/tasks, GET/PUT/DELETE /api/tasks/:id
  Move:     PATCH /api/tasks/:id/move
  Columns:  GET/POST /api/columns, PUT/DELETE /api/columns/:id
  Settings: GET/PUT /api/settings
  Webhooks: GET/POST /api/webhooks, DELETE /api/webhooks/:id
`)
        process.exit(0)
    }
  }

  return { dir, port, noBrowser }
}

const { dir, port, noBrowser } = parseArgs(process.argv.slice(2))

const server = startServer(dir, port)

if (!noBrowser) {
  server.on('listening', async () => {
    try {
      const open = (await import('open')).default
      open(`http://localhost:${port}`)
    } catch {
      // open is optional, just print the URL
    }
  })
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...')
  server.close()
  process.exit(0)
})

process.on('SIGTERM', () => {
  server.close()
  process.exit(0)
})
