import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

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

export default defineConfig({
  plugins: [react(), standaloneHtmlPlugin()],
  root: resolve(__dirname, 'src/webview'),
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true
      },
      '/api': {
        target: 'http://localhost:3001'
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
