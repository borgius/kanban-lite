import type {
  PluginSettingsOptionsSchemaMetadata,
  PluginSettingsRedactionPolicy,
} from 'kanban-lite/sdk'

const MYSQL_SECRET_REDACTION: PluginSettingsRedactionPolicy = {
  maskedValue: '••••••',
  writeOnly: true,
  targets: ['read', 'list', 'error'],
}

export function createMysqlOptionsSchema(): PluginSettingsOptionsSchemaMetadata {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['database'],
      properties: {
        host: {
          type: 'string',
          title: 'Host',
          description: 'MySQL server hostname.',
          default: 'localhost',
        },
        port: {
          type: 'number',
          title: 'Port',
          description: 'MySQL server port.',
          default: 3306,
        },
        user: {
          type: 'string',
          title: 'User',
          description: 'MySQL user.',
          default: 'root',
        },
        password: {
          type: 'string',
          title: 'Password',
          description: 'MySQL password.',
        },
        database: {
          type: 'string',
          title: 'Database',
          description: 'MySQL database schema to use.',
          minLength: 1,
        },
      },
    },
    secrets: [
      { path: 'password', redaction: MYSQL_SECRET_REDACTION },
    ],
  }
}
