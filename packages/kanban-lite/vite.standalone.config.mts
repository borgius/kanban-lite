import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// In dev mode, spawn the standalone server from TS source via tsx (no build needed)
function standaloneServerPlugin(configFile: string, port = 2954): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'standalone-server',
    apply: 'serve',
    configureServer(server) {
      child = spawn(
        'tsx',
        ['src/standalone/index.ts', '--port', String(port), '--no-browser', '--config', configFile],
        { stdio: 'inherit', cwd: resolve(__dirname), env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } }
      )
      server.httpServer?.on('close', () => child?.kill())
      process.on('exit', () => child?.kill())
    }
  }
}

// In dev mode, serve standalone.html for all non-asset requests (SPA routing)
function standaloneHtmlPlugin(): Plugin {
  return {
    name: 'standalone-html',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url || '/'
        // Skip API paths, WebSocket connections, and static asset requests
        if (
          url.startsWith('/api') ||
          url.startsWith('/ws') ||
          /\.[a-z0-9]{1,6}(\?|$)/i.test(url)
        ) {
          return next()
        }
        req.url = '/standalone.html'
        next()
      })
    }
  }
}

const configFile = process.env.KANBAN_CONFIG ?? resolve(__dirname, '../../.kanban.json')

export default defineConfig({
  plugins: [react(), standaloneServerPlugin(configFile, 2954), standaloneHtmlPlugin()],
  root: resolve(__dirname, 'src/webview'),
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'ws://localhost:2954',
        ws: true
      },
      '/api': {
        target: 'http://localhost:2954'
      }
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist/standalone-webview'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/webview/standalone-main.tsx')
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-[hash].js',
        assetFileNames: '[name].[ext]',
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'icons': ['lucide-react']
        }
      }
    },
    cssCodeSplit: false,
    sourcemap: true,
    chunkSizeWarningLimit: 300
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
