import type {
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
} from 'kanban-lite/sdk'

const POSTGRESQL_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

export function createPostgresqlOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['database'],
      properties: {
        host: {
          type: 'string',
          title: 'Host',
          description: 'PostgreSQL server hostname.',
          default: 'localhost',
        },
        port: {
          type: 'number',
          title: 'Port',
          description: 'PostgreSQL server port.',
          default: 5432,
        },
        user: {
          type: 'string',
          title: 'User',
          description: 'PostgreSQL user.',
          default: 'postgres',
        },
        password: {
          type: 'string',
          title: 'Password',
          description: 'PostgreSQL password.',
        },
        database: {
          type: 'string',
          title: 'Database',
          description: 'PostgreSQL database name.',
          minLength: 1,
        },
      },
    },
    secrets: [
      { path: 'password', redaction: POSTGRESQL_SECRET_REDACTION },
    ],
  }
}
