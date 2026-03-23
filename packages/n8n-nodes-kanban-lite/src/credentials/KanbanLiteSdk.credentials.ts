import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Credential type for Kanban Lite local SDK transport.
 *
 * Provides filesystem path settings so the n8n node can instantiate a
 * KanbanSDK instance against a local workspace without requiring a running
 * standalone server.
 */
export class KanbanLiteSdk implements ICredentialType {
  name = 'kanbanLiteSdk';
  displayName = 'Kanban Lite SDK (Local)';
  documentationUrl = 'https://github.com/borgius/kanban-lite#readme';
  properties: INodeProperties[] = [
    {
      displayName: 'Workspace Root',
      name: 'workspaceRoot',
      type: 'string',
      default: '',
      placeholder: '/path/to/workspace',
      required: true,
      description:
        'Absolute path to the workspace root that contains .kanban.json (the same directory you pass to kanban-lite CLI or the standalone server)',
    },
    {
      displayName: 'Board Directory',
      name: 'boardDir',
      type: 'string',
      default: '',
      placeholder: '/path/to/boards',
      description:
        'Optional: absolute path to the board directory. When left empty the SDK uses the default derived from the workspace root.',
    },
  ];
}
