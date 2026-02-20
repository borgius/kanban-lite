import { startServer } from './server'

function parseArgs(args: string[]): { dir: string; port: number; noBrowser: boolean } {
  let dir = '.devtool/features'
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
  -d, --dir <path>    Features directory (default: .devtool/features)
  -p, --port <number> Port to listen on (default: 3000)
  --no-browser        Don't open browser automatically
  -h, --help          Show this help message
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
