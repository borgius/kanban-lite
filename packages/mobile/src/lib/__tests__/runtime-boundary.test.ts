import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConfigContext } from 'expo/config'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import resolveAppConfig from '../../../app.config'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const MOBILE_ROOT = path.resolve(TEST_DIR, '../../..')
const APP_CONFIG_PATH = path.join(MOBILE_ROOT, 'app.config.ts')
const PACKAGE_JSON_PATH = path.join(MOBILE_ROOT, 'package.json')
const SOURCE_ROOTS = [path.join(MOBILE_ROOT, 'app'), path.join(MOBILE_ROOT, 'src')]
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])
const LAYOUT_PATH = path.join(MOBILE_ROOT, 'app/_layout.tsx')

function createConfigContext(config: ConfigContext['config'] = {}): ConfigContext {
  return {
    config,
    projectRoot: MOBILE_ROOT,
    staticConfigPath: APP_CONFIG_PATH,
    packageJsonPath: PACKAGE_JSON_PATH,
  }
}

function collectSourceFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        return []
      }
      return collectSourceFiles(entryPath)
    }

    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      return []
    }

    if (/\.(test|spec)\.[jt]sx?$/.test(entry.name)) {
      return []
    }

    return [entryPath]
  })
}

function getScriptKind(filePath: string): ts.ScriptKind {
  switch (path.extname(filePath)) {
    case '.tsx':
      return ts.ScriptKind.TSX
    case '.ts':
      return ts.ScriptKind.TS
    case '.jsx':
      return ts.ScriptKind.JSX
    default:
      return ts.ScriptKind.JS
  }
}

function isForbiddenRuntimeSpecifier(specifier: string): boolean {
  return (
    specifier === 'kanban-lite/sdk' ||
    specifier === 'kanban-lite/sdk/index' ||
    specifier.includes('packages/kanban-lite/src/sdk') ||
    specifier.includes('kanban-lite/src/sdk')
  )
}

function collectForbiddenRuntimeImports(filePath: string): string[] {
  const sourceText = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(filePath),
  )
  const violations = new Set<string>()

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const isTypeOnly = node.importClause?.isTypeOnly ?? false
      if (!isTypeOnly && isForbiddenRuntimeSpecifier(node.moduleSpecifier.text)) {
        violations.add(node.moduleSpecifier.text)
      }
    }

    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !node.isTypeOnly &&
      isForbiddenRuntimeSpecifier(node.moduleSpecifier.text)
    ) {
      violations.add(node.moduleSpecifier.text)
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression) &&
      isForbiddenRuntimeSpecifier(node.moduleReference.expression.text)
    ) {
      violations.add(node.moduleReference.expression.text)
    }

    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [firstArgument] = node.arguments
      if (ts.isStringLiteral(firstArgument) && isForbiddenRuntimeSpecifier(firstArgument.text)) {
        const isRequireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require'
        const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword

        if (isRequireCall || isDynamicImport) {
          violations.add(firstArgument.text)
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return [...violations].sort()
}

describe('mobile Expo shell boundary', () => {
  it('keeps a typed root layout ready for shell and auth providers', () => {
    expect(fs.existsSync(LAYOUT_PATH)).toBe(true)

    const layoutSource = fs.readFileSync(LAYOUT_PATH, 'utf8')
    expect(layoutSource).toContain('SafeAreaProvider')
    expect(layoutSource).toContain('StatusBar')
    expect(layoutSource).toContain('<Stack')
  })

  it('derives unique non-production deep-link schemes for parallel installs', () => {
    const originalVariant = process.env.APP_VARIANT

    try {
      process.env.APP_VARIANT = 'development'
      const developmentConfig = resolveAppConfig(createConfigContext())
      process.env.APP_VARIANT = 'preview'
      const previewConfig = resolveAppConfig(createConfigContext())
      process.env.APP_VARIANT = 'production'
      const productionConfig = resolveAppConfig(createConfigContext())

      expect(developmentConfig.ios?.bundleIdentifier).not.toBe(previewConfig.ios?.bundleIdentifier)
      expect(previewConfig.ios?.bundleIdentifier).not.toBe(productionConfig.ios?.bundleIdentifier)
      expect(developmentConfig.scheme).not.toBe(previewConfig.scheme)
      expect(previewConfig.scheme).not.toBe(productionConfig.scheme)
    } finally {
      if (originalVariant === undefined) {
        delete process.env.APP_VARIANT
      } else {
        process.env.APP_VARIANT = originalVariant
      }
    }
  })

  it('does not import the Node-only kanban-lite sdk runtime from mobile sources', () => {
    const violations = SOURCE_ROOTS.flatMap((sourceRoot) =>
      collectSourceFiles(sourceRoot).flatMap((filePath) =>
        collectForbiddenRuntimeImports(filePath).map(
          (specifier) => `${path.relative(MOBILE_ROOT, filePath)} -> ${specifier}`,
        ),
      ),
    )

    expect(violations).toEqual([])
  })
})
