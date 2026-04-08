import { createRequire } from 'node:module'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Type declarations for the lazily-loaded pg driver
// ---------------------------------------------------------------------------

interface PgPoolClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
  release(): void
}

export interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>
  connect(): Promise<PgPoolClient>
  end(): Promise<void>
}

type PgModule = {
  Pool: new (config: Record<string, unknown>) => PgPool
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Connection options for the PostgreSQL card-storage engine.
 * Passed via the `options` field of the `card.storage` provider reference in `.kanban.json`.
 */
export interface PostgresqlConnectionConfig {
  /** PostgreSQL server hostname. @default 'localhost' */
  host?: string
  /** PostgreSQL server port. @default 5432 */
  port?: number
  /** PostgreSQL user. @default 'postgres' */
  user?: string
  /** PostgreSQL password. */
  password?: string
  /** PostgreSQL database name (required). */
  database: string
  /** Optional SSL configuration passed through to pg. */
  ssl?: unknown
}

const POSTGRESQL_DATABASE_OPTION_ERROR =
  'kl-plugin-storage-postgresql: PostgreSQL storage requires a "database" option. '
  + 'Set it in .kanban.json: { "plugins": { "card.storage": { "provider": "postgresql", '
  + '"options": { "database": "my_db", "host": "localhost", "user": "postgres", "password": "" } } } }'

export function resolvePostgresqlConnectionConfig(options?: Record<string, unknown>): PostgresqlConnectionConfig {
  const database = options?.database
  if (typeof database !== 'string' || !database) {
    throw new Error(POSTGRESQL_DATABASE_OPTION_ERROR)
  }

  return {
    host: (options?.host as string | undefined) ?? 'localhost',
    port: typeof options?.port === 'number' ? options.port : 5432,
    user: (options?.user as string | undefined) ?? 'postgres',
    password: (options?.password as string | undefined) ?? '',
    database,
    ...(options?.ssl !== undefined ? { ssl: options.ssl } : {}),
  }
}

// ---------------------------------------------------------------------------
// Lazy driver loader
// ---------------------------------------------------------------------------

const runtimeRequire = createRequire(
  typeof __filename === 'string' && __filename
    ? __filename
    : path.join(process.cwd(), '__kanban-runtime__.cjs')
)

/**
 * Lazily loads the `pg` driver.
 * Throws a clear, actionable install error when the driver is absent.
 */
export function loadPgDriver(): PgModule {
  try {
    return runtimeRequire('pg') as PgModule
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'PostgreSQL storage requires the pg driver. '
        + 'Install it as a runtime dependency: npm install pg',
      )
    }
    throw err
  }
}
