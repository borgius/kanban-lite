#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const targets = process.argv.slice(2)

if (targets.length === 0) {
  console.error('Usage: node scripts/ensure-built.mjs <artifact> [artifact...]')
  process.exit(1)
}

const missingTargets = targets.filter((target) => !fs.existsSync(path.resolve(process.cwd(), target)))

if (missingTargets.length > 0) {
  console.error('Missing build artifacts:')
  for (const target of missingTargets) {
    console.error(`- ${target}`)
  }
  console.error('Run the workspace build before packaging or publishing this package.')
  process.exit(1)
}

console.log(`Verified build artifacts: ${targets.join(', ')}`)
