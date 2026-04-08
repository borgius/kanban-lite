import { createRequire } from 'node:module'
import * as path from 'node:path'

// ---------------------------------------------------------------------------
// Type declarations for the lazily-loaded mysql2/promise driver
// ---------------------------------------------------------------------------

export interface MysqlPool {
  execute(sql: string, params?: unknown[]): Promise<[unknown[], unknown]>
  end(): Promise<void>
}

type Mysql2PromiseModule = {
  createPool(config: Record<string, unknown>): MysqlPool
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Connection options for the MySQL card-storage engine.
 * Passed via the `options` field of the `card.storage` provider reference in `.kanban.json`.
 */
export interface MysqlConnectionConfig {
  /** MySQL server hostname. @default 'localhost' */
  host?: string
  /** MySQL server port. @default 3306 */
  port?: number
  /** MySQL user. @default 'root' */
  user?: string
  /** MySQL password. */
  password?: string
  /** MySQL database schema to use (required). */
  database: string
  /** Optional SSL configuration passed through to mysql2. */
  ssl?: unknown
}

const MYSQL_DATABASE_OPTION_ERROR =
  'kl-plugin-storage-mysql: MySQL storage requires a "database" option. '
  + 'Set it in .kanban.json: { "plugins": { "card.storage": { "provider": "mysql", '
  + '"options": { "database": "my_db", "host": "localhost", "user": "root", "password": "" } } } }'

export function resolveMysqlConnectionConfig(options?: Record<string, unknown>): MysqlConnectionConfig {
  const database = options?.database
  if (typeof database !== 'string' || !database) {
    throw new Error(MYSQL_DATABASE_OPTION_ERROR)
  }

  return {
    host: (options?.host as string | undefined) ?? 'localhost',
    port: typeof options?.port === 'number' ? options.port : 3306,
    user: (options?.user as string | undefined) ?? 'root',
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
 * Lazily loads the `mysql2/promise` driver.
 * Throws a clear, actionable install error when the driver is absent.
 */
export function loadMysql2Driver(): Mysql2PromiseModule {
  try {
    return runtimeRequire('mysql2/promise') as Mysql2PromiseModule
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'MySQL storage requires the mysql2 driver. '
        + 'Install it as a runtime dependency: npm install mysql2',
      )
    }
    throw err
  }
}
