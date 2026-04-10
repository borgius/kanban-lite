import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildActionWebhookUrl,
  resolveActionWebhookSecretForLocalStack,
} from '../lib/action-webhook-auth.js';
import { buildCorePilotScenarioCards, buildDemoCardContent } from '../lib/demo-scenario.js';

const mode = process.argv[2] === 'start' ? 'start' : 'dev';
const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(__dirname, '..');
const demoWorkspaceRoot = join(exampleRoot, 'demo-workspace');
const configFilePath = join(demoWorkspaceRoot, '.kanban.json');
const kanbanDir = join(demoWorkspaceRoot, '.kanban');

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(content) {
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = unquote(value);
  }

  return entries;
}

async function loadExampleEnv() {
  const envFiles = [
    '.env',
    '.env.local',
    mode === 'start' ? '.env.production' : '.env.development',
    mode === 'start' ? '.env.production.local' : '.env.development.local',
  ];

  const loaded = {};

  for (const fileName of envFiles) {
    try {
      const content = await readFile(join(exampleRoot, fileName), 'utf8');
      Object.assign(loaded, parseEnvFile(content));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
  }

  return loaded;
}

const fileEnv = await loadExampleEnv();
const runtimeEnv = {
  ...fileEnv,
  ...process.env,
};
const host = runtimeEnv.DEMO_HOST ?? '127.0.0.1';
const kanbanPort = Number.parseInt(runtimeEnv.KANBAN_PORT ?? '3000', 10);
const chatPort = Number.parseInt(runtimeEnv.CHAT_PORT ?? '3001', 10);
const { secret: actionWebhookSecret, source: actionWebhookSecretSource } = resolveActionWebhookSecretForLocalStack(runtimeEnv);
const kanbanUrl = `http://${host}:${kanbanPort}`;
const chatUrl = `http://${host}:${chatPort}`;

function resolveLocalBin(binName) {
  return join(
    exampleRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? `${binName}.cmd` : binName,
  );
}

function prefixLines(prefix, text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `${prefix} ${line}`)
    .join('\n');
}

function pipeOutput(child, prefix) {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`${prefixLines(prefix, String(chunk))}\n`);
  });

  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`${prefixLines(prefix, String(chunk))}\n`);
  });
}

function spawnProcess(label, command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: exampleRoot,
    env: {
      ...runtimeEnv,
      ...env,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  pipeOutput(child, `[${label}]`);
  return child;
}

function spawnKanbanProcess() {
  return spawnProcess(
    `${mode}:kanban`,
    resolveLocalBin('tsx'),
    [
      '../../packages/kanban-lite/src/standalone/bin.ts',
      '--config',
      './demo-workspace/.kanban.json',
      '--dir',
      './demo-workspace/.kanban',
      '--port',
      String(kanbanPort),
      '--no-browser',
    ],
  );
}

function spawnChatProcess() {
  return spawnProcess(
    `${mode}:chat`,
    resolveLocalBin('next'),
    [mode, '--port', String(chatPort)],
    {
      ACTION_WEBHOOK_SECRET: actionWebhookSecret,
      KANBAN_API_URL: kanbanUrl,
      KANBAN_BOARD_ID: 'default',
      KANBAN_USE_MOCK: 'false',
      NEXT_PUBLIC_KANBAN_WEB_URL: kanbanUrl,
      NEXT_PUBLIC_CHAT_URL: chatUrl,
    },
  );
}

async function waitForUrl(url, timeoutMs = 60_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // server still starting
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function ensureDemoWorkspaceConfig() {
  await mkdir(kanbanDir, { recursive: true });

  const config = JSON.parse(await readFile(configFilePath, 'utf8'));
  config.port = kanbanPort;
  config.kanbanDirectory = '.kanban';
  config.actionWebhookUrl = buildActionWebhookUrl(`${chatUrl}/api/action-webhook`, actionWebhookSecret);

  await writeFile(configFilePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function apiFetch(pathname, init) {
  const response = await fetch(`${kanbanUrl}${pathname}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });

  const text = await response.text();
  if (!text) {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}: ${pathname}`);
    }
    return null;
  }

  const payload = JSON.parse(text);
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}: ${pathname}`);
  }

  return payload.data;
}

async function seedDemoBoard() {
  const cards = await apiFetch('/api/boards/default/tasks');
  if (Array.isArray(cards) && cards.length > 0) {
    console.log('[local-stack] Demo board already has cards; leaving your existing board state intact.');
    return;
  }

  for (const seed of buildCorePilotScenarioCards()) {
    const createdCard = await apiFetch('/api/boards/default/tasks', {
      method: 'POST',
      body: JSON.stringify({
        content: buildDemoCardContent(seed.title, seed.description),
        status: seed.status,
        priority: seed.priority,
        assignee: seed.assignee,
        labels: seed.labels,
        metadata: seed.metadata,
        actions: seed.actions,
        forms: seed.forms,
        formData: seed.formData,
      }),
    });

    for (const comment of seed.comments ?? []) {
      await apiFetch(`/api/tasks/${encodeURIComponent(createdCard.id)}/comments`, {
        method: 'POST',
        body: JSON.stringify(comment),
      });
    }
  }

  console.log('[local-stack] Seeded CorePilot demo cards with comments, forms, and actions.');
}

if (actionWebhookSecretSource === 'generated') {
  console.log('[local-stack] Generated a fresh ACTION_WEBHOOK_SECRET for this run and rewired demo-workspace/.kanban.json locally.');
} else {
  console.log('[local-stack] Using ACTION_WEBHOOK_SECRET from the environment for the local action webhook route.');
}

function forwardShutdown(children) {
  let shuttingDown = false;

  const stopChildren = (signal = 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;

    for (const child of children) {
      if (!child.killed) {
        child.kill(signal);
      }
    }
  };

  process.on('SIGINT', () => {
    stopChildren('SIGINT');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopChildren('SIGTERM');
    process.exit(0);
  });

  return stopChildren;
}

async function main() {
  await ensureDemoWorkspaceConfig();

  console.log(`[local-stack] Kanban URL: ${kanbanUrl}`);
  console.log(`[local-stack] Chat URL:   ${chatUrl}`);
  console.log(`[local-stack] Workspace:  ${configFilePath}`);

  const kanbanProcess = spawnKanbanProcess();
  const managedChildren = [kanbanProcess];
  const stopChildren = forwardShutdown(managedChildren);

  kanbanProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[local-stack] Kanban process exited with code ${code}.`);
      process.exit(code);
    }
  });

  await waitForUrl(`${kanbanUrl}/api/workspace`);
  await seedDemoBoard();

  const chatProcess = spawnChatProcess();

  managedChildren.push(chatProcess);

  chatProcess.on('exit', (code) => {
    stopChildren();
    process.exit(code ?? 0);
  });

  kanbanProcess.on('exit', (code) => {
    if (chatProcess.exitCode === null) {
      chatProcess.kill('SIGTERM');
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error('[local-stack] Failed to start local stack:', error);
  process.exit(1);
});
