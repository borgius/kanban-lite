import { spawnSync } from 'node:child_process'

import {
  resolveMysqlConnectionConfig,
  type MysqlConnectionConfig,
} from './connection.js'
import type {
  ConfigStorageModuleContext,
  ConfigStorageProviderPlugin,
} from './shared.js'

type MysqlConfigStorageCommand =
  | {
      action: 'read'
      connection: MysqlConnectionConfig
      documentId: string
    }
  | {
      action: 'write'
      connection: MysqlConnectionConfig
      documentId: string
      document: Record<string, unknown>
    }

type MysqlConfigStorageRunner = (command: MysqlConfigStorageCommand) => Record<string, unknown> | null

const MYSQL_CONFIG_STORAGE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kanban_config_documents (
  document_id  VARCHAR(1024) NOT NULL,
  document_text LONGTEXT     NOT NULL,
  updated_at   VARCHAR(50)   NOT NULL,
  PRIMARY KEY (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`

const MYSQL_CONFIG_STORAGE_SELECT_SQL =
  'SELECT document_text FROM kanban_config_documents WHERE document_id = ?'

const MYSQL_CONFIG_STORAGE_UPSERT_SQL = `
INSERT INTO kanban_config_documents (document_id, document_text, updated_at)
VALUES (?, ?, ?)
ON DUPLICATE KEY UPDATE
  document_text = VALUES(document_text),
  updated_at = VALUES(updated_at)
`

function runMysqlConfigStorageCommand(command: MysqlConfigStorageCommand): Record<string, unknown> | null {
  const script = `
const fs = require('node:fs');
const payload = JSON.parse(fs.readFileSync(0, 'utf8'));
const mysql2 = require('mysql2/promise');
const schemaSql = ${JSON.stringify(MYSQL_CONFIG_STORAGE_SCHEMA_SQL)};
const selectSql = ${JSON.stringify(MYSQL_CONFIG_STORAGE_SELECT_SQL)};
const upsertSql = ${JSON.stringify(MYSQL_CONFIG_STORAGE_UPSERT_SQL)};

(async () => {
  const connection = payload.connection ?? {};
  const pool = mysql2.createPool({
    host: connection.host ?? 'localhost',
    port: connection.port ?? 3306,
    user: connection.user ?? 'root',
    password: connection.password ?? '',
    database: connection.database,
    waitForConnections: true,
    connectionLimit: 1,
    ...(connection.ssl !== undefined ? { ssl: connection.ssl } : {}),
  });

  try {
    await pool.execute(schemaSql);

    if (payload.action === 'read') {
      const result = await pool.execute(selectSql, [payload.documentId]);
      const rows = Array.isArray(result[0]) ? result[0] : [];
      const row = rows[0];
      const rawDocument = row && typeof row.document_text === 'string' ? row.document_text : null;
      process.stdout.write(rawDocument ?? 'null');
      return;
    }

    await pool.execute(upsertSql, [
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
      `kl-plugin-storage-mysql: unable to ${command.action} workspace config via MySQL.`
      + (details ? `\n${details}` : ''),
    )
  }

  const rawOutput = result.stdout.trim()
  if (!rawOutput || rawOutput === 'null') return null

  const parsed = JSON.parse(rawOutput) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('kl-plugin-storage-mysql: MySQL config storage returned an invalid config document.')
  }

  return parsed as Record<string, unknown>
}

let mysqlConfigStorageRunner: MysqlConfigStorageRunner = runMysqlConfigStorageCommand

export function __setMysqlConfigStorageRunnerForTests(
  runner: MysqlConfigStorageRunner | null,
): void {
  mysqlConfigStorageRunner = runner ?? runMysqlConfigStorageCommand
}

export function createConfigStorageProvider(context: ConfigStorageModuleContext): ConfigStorageProviderPlugin {
  const connection = resolveMysqlConnectionConfig(context.options)

  return {
    manifest: { id: 'mysql', provides: ['config.storage'] as const },
    readConfigDocument(): Record<string, unknown> | null {
      return mysqlConfigStorageRunner({
        action: 'read',
        connection,
        documentId: context.documentId,
      })
    },
    writeConfigDocument(document: Record<string, unknown>): void {
      mysqlConfigStorageRunner({
        action: 'write',
        connection,
        documentId: context.documentId,
        document,
      })
    },
  }
}
