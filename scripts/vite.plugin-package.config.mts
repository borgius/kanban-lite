import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { resolve } from 'node:path'

import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

type PackageJson = {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const packageDir = process.env.KANBAN_PLUGIN_PACKAGE_DIR ?? process.cwd()
const packageJson = JSON.parse(
  readFileSync(resolve(packageDir, 'package.json'), 'utf8')
) as PackageJson

const externalPackages = [
  ...Object.keys(packageJson.dependencies ?? {}),
  ...Object.keys(packageJson.peerDependencies ?? {})
]

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`)
])

function isExternal(id: string): boolean {
  if (id.startsWith('node:')) {
    return true
  }

  if (builtins.has(id)) {
    return true
  }

  const builtinBase = id.split('/')[0]
  if (builtins.has(builtinBase)) {
    return true
  }

  return externalPackages.some((pkg) => id === pkg || id.startsWith(`${pkg}/`))
}

export default defineConfig({
  build: {
    target: 'es2020',
    outDir: resolve(packageDir, 'dist'),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve(packageDir, 'src/index.ts'),
      formats: ['cjs']
    },
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: 'index.cjs',
        exports: 'named'
      }
    }
  },
  plugins: [
    dts({
      tsconfigPath: resolve(packageDir, 'tsconfig.json'),
      entryRoot: resolve(packageDir, 'src'),
      outDir: resolve(packageDir, 'dist'),
      include: [resolve(packageDir, 'src/**/*.ts')],
      exclude: [
        resolve(packageDir, 'src/**/*.test.ts'),
        resolve(packageDir, 'src/**/*.integration.test.ts'),
        resolve(packageDir, 'src/**/*.workspace.test.ts')
      ]
    })
  ]
})