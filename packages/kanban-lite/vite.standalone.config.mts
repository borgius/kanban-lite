import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Spawn the standalone server from TS source when Vite starts in watch mode
function standaloneServerPlugin(configFile: string, port = 2954): Plugin {
  let child: ChildProcess | null = null
  return {
    name: 'standalone-server',
    closeBundle() {
      if (child) return // already running after first build
      child = spawn(
        'tsx',
        ['src/standalone/index.ts', '--port', String(port), '--no-browser', '--config', configFile],
        { stdio: 'inherit', cwd: resolve(__dirname) }
      )
      process.on('exit', () => child?.kill())
      process.on('SIGINT', () => { child?.kill(); process.exit(0) })
    }
  }
}

const configFile = process.env.KANBAN_CONFIG ?? resolve(__dirname, '../../.kanban.json')

export default defineConfig({
  plugins: [react(), standaloneServerPlugin(configFile, 2954)],
  root: resolve(__dirname, 'src/webview'),
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
