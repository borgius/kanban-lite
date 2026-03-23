import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Credential type for Kanban Lite remote API transport.
 *
 * Configures base URL and optional bearer-token or API-key authentication
 * for the kanban-lite standalone server.
 */
export class KanbanLiteApi implements ICredentialType {
  name = 'kanbanLiteApi';
  displayName = 'Kanban Lite API';
  documentationUrl =
    'https://github.com/borgius/kanban-lite/blob/main/docs/api.md';
  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'http://localhost:3000',
      placeholder: 'http://localhost:3000',
      required: true,
      description:
        'Base URL of the Kanban Lite standalone server, e.g. http://localhost:3000',
    },
    {
      displayName: 'Auth Mode',
      name: 'authMode',
      type: 'options',
      options: [
        { name: 'None', value: 'none' },
        { name: 'Bearer Token', value: 'bearerToken' },
        { name: 'API Key Header', value: 'apiKey' },
      ],
      default: 'none',
      description:
        'Authentication method configured on the standalone server. Select None if no auth plugin is active.',
    },
    {
      displayName: 'Token / API Key',
      name: 'token',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description:
        'Bearer token (Authorization: Bearer …) or API key value sent in the configured header',
      displayOptions: {
        show: {
          authMode: ['bearerToken', 'apiKey'],
        },
      },
    },
    {
      displayName: 'API Key Header Name',
      name: 'apiKeyHeader',
      type: 'string',
      default: 'X-Api-Key',
      description:
        'HTTP header name used to pass the API key when auth mode is API Key Header',
      displayOptions: {
        show: {
          authMode: ['apiKey'],
        },
      },
    },
  ];
}
