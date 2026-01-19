#!/usr/bin/env node

/**
 * Release script for version bumping and git tagging
 *
 * Usage:
 *   pnpm release patch   # 0.1.0 -> 0.1.1
 *   pnpm release minor   # 0.1.0 -> 0.2.0
 *   pnpm release major   # 0.1.0 -> 1.0.0
 *   pnpm release 1.2.3   # Set specific version
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');

function run(cmd, options = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...options });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf-8' }).trim();
}

function getPackageJson() {
  return JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
}

function setPackageVersion(version) {
  const pkg = getPackageJson();
  pkg.version = version;
  fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

function bumpVersion(current, type) {
  const [major, minor, patch] = current.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      // Assume it's a specific version
      if (/^\d+\.\d+\.\d+$/.test(type)) {
        return type;
      }
      throw new Error(`Invalid version type: ${type}`);
  }
}

function main() {
  const type = process.argv[2] || 'patch';

  // Check for uncommitted changes
  try {
    const status = runCapture('git status --porcelain');
    if (status) {
      console.error('Error: Working directory is not clean. Commit or stash changes first.');
      process.exit(1);
    }
  } catch {
    console.error('Error: Not a git repository');
    process.exit(1);
  }

  // Check we're on main branch
  const branch = runCapture('git branch --show-current');
  if (branch !== 'main') {
    console.error(`Warning: You are on branch '${branch}', not 'main'.`);
    console.error('Consider switching to main before releasing.');
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    return new Promise((resolve) => {
      rl.question('Continue anyway? (y/N) ', (answer) => {
        rl.close();
        if (answer.toLowerCase() !== 'y') {
          console.log('Aborted.');
          process.exit(0);
        }
        resolve();
      });
    }).then(doRelease);
  }

  return doRelease();

  function doRelease() {
    const pkg = getPackageJson();
    const currentVersion = pkg.version;
    const newVersion = bumpVersion(currentVersion, type);

    console.log(`\nReleasing ${pkg.name}`);
    console.log(`  Current version: ${currentVersion}`);
    console.log(`  New version:     ${newVersion}\n`);

    // Update package.json
    setPackageVersion(newVersion);
    console.log(`Updated package.json to ${newVersion}`);

    // Commit the version bump
    run(`git add package.json`);
    run(`git commit -m "chore: release v${newVersion}"`);

    // Create git tag
    run(`git tag -a v${newVersion} -m "Release v${newVersion}"`);

    console.log(`\n✓ Created tag v${newVersion}`);
    console.log(`\nTo publish, push the tag:`);
    console.log(`  git push origin main --tags`);
    console.log(`\nThis will trigger the release workflow on GitHub.`);
  }
}

main();
