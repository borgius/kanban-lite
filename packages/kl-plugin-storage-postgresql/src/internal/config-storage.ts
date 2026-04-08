import { spawnSync } from 'node:child_process'

import {
  resolvePostgresqlConnectionConfig,
  type PostgresqlConnectionConfig,
} from './connection.js'
import type {
  ConfigStorageModuleContext,
  ConfigStorageProviderPlugin,
} from './shared.js'

type PostgresqlConfigStorageCommand =
  | {
      action: 'read'
      connection: PostgresqlConnectionConfig
      documentId: string
    }
  | {
      action: 'write'
      connection: PostgresqlConnectionConfig
      documentId: string
      document: Record<string, unknown>
    }

type PostgresqlConfigStorageRunner = (
  command: PostgresqlConfigStorageCommand,
) => Record<string, unknown> | null

const POSTGRESQL_CONFIG_STORAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kanban_config_documents (
  document_id TEXT PRIMARY KEY,
  document_text TEXT NOT NULL,
  updated_at VARCHAR(50) NOT NULL
)
`

const POSTGRESQL_CONFIG_STORAGE_SELECT_SQL =
  'SELECT document_text FROM kanban_config_documents WHERE document_id = $1'

const POSTGRESQL_CONFIG_STORAGE_UPSERT_SQL = `
INSERT INTO kanban_config_documents (document_id, document_text, updated_at)
VALUES ($1, $2, $3)
ON CONFLICT (document_id) DO UPDATE SET
  document_text = EXCLUDED.document_text,
  updated_at = EXCLUDED.updated_at
`

function runPostgresqlConfigStorageCommand(
  command: PostgresqlConfigStorageCommand,
): Record<string, unknown> | null {
  const script = `
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const { Pool } = require('pg');
const schemaSql = ${JSON.stringify(POSTGRESQL_CONFIG_STORAGE_SCHEMA_SQL)};
const selectSql = ${JSON.stringify(POSTGRESQL_CONFIG_STORAGE_SELECT_SQL)};
const upsertSql = ${JSON.stringify(POSTGRESQL_CONFIG_STORAGE_UPSERT_SQL)};

(async () => {
  const connection = payload.connection ?? {};
  const pool = new Pool({
    host: connection.host ?? 'localhost',
    port: connection.port ?? 5432,
    user: connection.user ?? 'postgres',
    password: connection.password ?? '',
    database: connection.database,
    max: 1,
    ...(connection.ssl !== undefined ? { ssl: connection.ssl } : {}),
  });

  try {
    await pool.query(schemaSql);

    if (payload.action === 'read') {
      const result = await pool.query(selectSql, [payload.documentId]);
      const row = Array.isArray(result.rows) ? result.rows[0] : undefined;
      const rawDocument = row && typeof row.document_text === 'string' ? row.document_text : null;
      process.stdout.write(rawDocument ?? 'null');
      return;
    }

    await pool.query(upsertSql, [
      payload.documentId,
      JSON.stringify(payload.document ?? {}),
      new Date().toISOString(),
    ]);
    process.stdout.write('null');
  } finally {
    await pool.end();
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`

  const result = spawnSync(process.execPath, ['-e', script], {
    input: JSON.stringify(command),
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
    throw new Error(
      `kl-plugin-storage-postgresql: unable to ${command.action} workspace config via PostgreSQL.`
      + (details ? `\n${details}` : ''),
    )
  }

  const rawOutput = result.stdout.trim()
  if (!rawOutput || rawOutput === 'null') return null

  const parsed = JSON.parse(rawOutput) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('kl-plugin-storage-postgresql: PostgreSQL config storage returned an invalid config document.')
  }

  return parsed as Record<string, unknown>
}

let postgresqlConfigStorageRunner: PostgresqlConfigStorageRunner = runPostgresqlConfigStorageCommand

export function __setPostgresqlConfigStorageRunnerForTests(
  runner: PostgresqlConfigStorageRunner | null,
): void {
  postgresqlConfigStorageRunner = runner ?? runPostgresqlConfigStorageCommand
}

export function createConfigStorageProvider(context: ConfigStorageModuleContext): ConfigStorageProviderPlugin {
  const connection = resolvePostgresqlConnectionConfig(context.options)

  return {
    manifest: { id: 'postgresql', provides: ['config.storage'] as const },
    readConfigDocument(): Record<string, unknown> | null {
      return postgresqlConfigStorageRunner({
        action: 'read',
        connection,
        documentId: context.documentId,
      })
    },
    writeConfigDocument(document: Record<string, unknown>): void {
      postgresqlConfigStorageRunner({
        action: 'write',
        connection,
        documentId: context.documentId,
        document,
      })
    },
  }
}
