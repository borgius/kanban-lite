#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const workspaceRoot = path.resolve(__dirname, '..')
const packagesDir = path.join(workspaceRoot, 'packages')
const mainPackageName = 'kanban-lite'
const releaseKinds = new Set(['patch', 'minor', 'major'])

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function run(command, args, { cwd = workspaceRoot, capture = false, allowFailure = false } = {}) {
  const printableCommand = `${command} ${args.join(' ')}`
  console.log(`\n$ ${printableCommand}`)

  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  })

  if (!allowFailure && result.status !== 0) {
    if (capture) {
      if (result.stdout) process.stdout.write(result.stdout)
      if (result.stderr) process.stderr.write(result.stderr)
    }
    throw new Error(`Command failed (${result.status ?? 'unknown'}): ${printableCommand}`)
  }

  return result
}

function listPublicPackages() {
  return fs
    .readdirSync(packagesDir)
    .sort((left, right) => {
      if (left === mainPackageName) return -1
      if (right === mainPackageName) return 1
      return left.localeCompare(right)
    })
    .map((directoryName) => {
      const dir = path.join(packagesDir, directoryName)
      const manifestPath = path.join(dir, 'package.json')
      if (!fs.existsSync(manifestPath)) {
        return null
      }
      const manifest = readJson(manifestPath)
      return {
        dir,
        manifest,
        manifestPath,
        name: manifest.name,
      }
    })
    .filter((pkg) => pkg && !pkg.manifest.private)
}

function hasScript(pkg, scriptName) {
  return typeof pkg.manifest.scripts?.[scriptName] === 'string'
}

async function promptForRetry(message) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(message)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    await rl.question(`${message}\nPress Enter to retry, or Ctrl+C to abort. `)
  } finally {
    rl.close()
  }
}

async function ensureAuth({ command, args, retryMessage, failureMessage }) {
  while (true) {
    const result = run(command, args, { capture: true, allowFailure: true })
    if (result.status === 0) {
      const details = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
      if (details) {
        console.log(details)
      }
      return
    }

    const details = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim()
    console.error(details || failureMessage)
    await promptForRetry(retryMessage)
  }
}

async function ensureReleaseAuth() {
  await ensureAuth({
    command: 'npm',
    args: ['whoami'],
    retryMessage:
      'npm auth is not ready. Refresh your npm release token (for example via npm login or a fresh NODE_AUTH_TOKEN / NPM_TOKEN) and then retry.',
    failureMessage: 'npm auth check failed.',
  })

  await ensureAuth({
    command: 'gh',
    args: ['auth', 'status'],
    retryMessage: 'GitHub CLI auth is not ready. Sign in with gh auth login and then retry.',
    failureMessage: 'GitHub auth check failed.',
  })
}

async function ensureGithubAuth() {
  await ensureAuth({
    command: 'gh',
    args: ['auth', 'status'],
    retryMessage: 'GitHub CLI auth is not ready. Sign in with gh auth login and then retry.',
    failureMessage: 'GitHub auth check failed.',
  })
}

function ensureCleanGit() {
  const status = run('git', ['status', '--short'], { capture: true })
  if ((status.stdout ?? '').trim()) {
    throw new Error('Working tree is not clean. Commit or stash existing changes before running a release.')
  }
}

function buildReleaseArtifacts(packages) {
  run('pnpm', ['run', 'build'])

  for (const pkg of packages) {
    if (pkg.name === mainPackageName || !hasScript(pkg, 'build')) {
      continue
    }

    run('npm', ['run', 'build'], { cwd: pkg.dir })
  }
}

function bumpPackageVersions(releaseKind, packages) {
  for (const pkg of packages) {
    run('npm', ['version', releaseKind, '--no-git-tag-version'], { cwd: pkg.dir })
  }
}

function getReleaseVersion() {
  return readJson(path.join(packagesDir, mainPackageName, 'package.json')).version
}

function ensureTagDoesNotExist(tagName) {
  const existingTag = run('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tagName}`], {
    capture: true,
    allowFailure: true,
  })

  if (existingTag.status === 0) {
    throw new Error(`Git tag ${tagName} already exists.`)
  }
}

function packageVsix() {
  run('pnpm', ['--filter', mainPackageName, 'run', 'package'])
}

function getVsixPath(version) {
  return path.join(workspaceRoot, 'releases', `kanban-lite-${version}.vsix`)
}

function publishNpmPackages(packages) {
  for (const pkg of packages) {
    run('npm', ['publish', '--ignore-scripts'], { cwd: pkg.dir })
  }
}

function commitAndPushRelease(packages, version) {
  const manifestPaths = packages.map((pkg) => path.relative(workspaceRoot, pkg.manifestPath))
  run('git', ['add', ...manifestPaths])
  run('git', ['commit', '-m', `chore: release v${version}`])
  run('git', ['tag', `v${version}`])

  const branchName = (run('git', ['branch', '--show-current'], { capture: true }).stdout ?? '').trim()
  if (!branchName) {
    throw new Error('Unable to determine the current git branch.')
  }

  run('git', ['push', 'origin', branchName])
  run('git', ['push', 'origin', `v${version}`])
}

function updateGithubRelease(version) {
  const tagName = `v${version}`
  const assetPath = getVsixPath(version)

  if (!fs.existsSync(assetPath)) {
    throw new Error(`Expected release artifact not found: ${path.relative(workspaceRoot, assetPath)}`)
  }

  const existingRelease = run('gh', ['release', 'view', tagName], {
    capture: true,
    allowFailure: true,
  })

  if (existingRelease.status === 0) {
    run('gh', ['release', 'upload', tagName, assetPath, '--clobber'])
    return
  }

  run('gh', ['release', 'create', tagName, assetPath, '--generate-notes'])
}

function printUsage() {
  console.log(`Usage: node scripts/release.mjs <patch|minor|major|github|check-auth>

patch|minor|major  Build once, bump all public package versions, publish npm packages, commit/tag/push, and update the GitHub release asset.
github             Upload or replace the current kanban-lite VSIX asset on the matching GitHub release.
check-auth         Verify npm and GitHub auth before starting a release.`)
}

async function runRelease(releaseKind) {
  const packages = listPublicPackages()

  if (packages.length === 0) {
    throw new Error('No public workspace packages were found to release.')
  }

  ensureCleanGit()
  await ensureReleaseAuth()
  buildReleaseArtifacts(packages)
  bumpPackageVersions(releaseKind, packages)

  const version = getReleaseVersion()
  const tagName = `v${version}`
  ensureTagDoesNotExist(tagName)

  packageVsix()
  publishNpmPackages(packages)
  commitAndPushRelease(packages, version)
  updateGithubRelease(version)

  console.log(`\nRelease complete: ${tagName}`)
}

async function main() {
  const command = process.argv[2]

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printUsage()
    return
  }

  if (releaseKinds.has(command)) {
    await runRelease(command)
    return
  }

  if (command === 'check-auth') {
    await ensureReleaseAuth()
    console.log('\nRelease auth looks good.')
    return
  }

  if (command === 'github') {
    await ensureGithubAuth()
    updateGithubRelease(getReleaseVersion())
    console.log('\nGitHub release asset updated.')
    return
  }

  printUsage()
  process.exitCode = 1
}

await main().catch((error) => {
  console.error(`\nRelease failed: ${error.message}`)
  process.exit(1)
})
