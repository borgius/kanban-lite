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

function getStandaloneManualChunk(id: string): string | undefined {
  const normalizedId = id.replaceAll('\\', '/')

  if (!normalizedId.includes('/node_modules/')) {
    return undefined
  }

  if (normalizedId.includes('/node_modules/react/') || normalizedId.includes('/node_modules/react-dom/')) {
    return 'react-vendor'
  }

  if (normalizedId.includes('/node_modules/@tanstack/react-router/')) {
    return 'router-vendor'
  }

  if (
    normalizedId.includes('/node_modules/@jsonforms/')
    || normalizedId.includes('/node_modules/ajv/')
  ) {
    return 'jsonforms-vendor'
  }

  if (
    normalizedId.includes('/node_modules/marked/')
    || normalizedId.includes('/node_modules/js-yaml/')
  ) {
    return 'content-vendor'
  }

  if (normalizedId.includes('/node_modules/lucide-react/')) {
    return 'icons'
  }

  return undefined
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
        manualChunks: getStandaloneManualChunk,
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
