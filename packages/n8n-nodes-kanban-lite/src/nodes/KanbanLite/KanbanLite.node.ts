import * as path from 'node:path';
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IDataObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { SdkTransport } from '../../transport/sdkAdapter';
import { ApiTransport } from '../../transport/apiAdapter';
import type { KanbanSdkLike } from '../../transport/sdkAdapter';
import type { ApiTransportCredentials, KanbanLiteTransport } from '../../transport/types';
import { KanbanTransportError } from '../../transport/types';

import { toItems, gStr, gArr, gJson, gBool, collectParams, buildTransport } from './KanbanLite.helpers';
import { propsA } from './KanbanLite.props-a';
import { propsB } from './KanbanLite.props-b';

export class KanbanLite implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Kanban Lite',
    name: 'kanbanLite',
    icon: 'file:kanban-lite.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
    description: 'Interact with a Kanban Lite workspace – boards, cards, comments, attachments, columns, labels, and more',
    defaults: { name: 'Kanban Lite' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'kanbanLiteApi',
        required: false,
        displayOptions: { show: { transport: ['api'] } },
      },
      {
        name: 'kanbanLiteSdk',
        required: false,
        displayOptions: { show: { transport: ['sdk'] } },
      },
    ],
    properties: [
      ...propsA,
      ...propsB,
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    let transport: KanbanLiteTransport;
    try {
      transport = await buildTransport(this);
    } catch (err) {
      if (err instanceof NodeOperationError) throw err;
      throw new NodeOperationError(this.getNode(), err as Error);
    }

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;
        const params = collectParams(this, resource, operation, i);

        let result: unknown;
        try {
          const r = await transport.execute(resource, operation, params);
          result = r.data;
        } catch (err) {
          if (err instanceof KanbanTransportError) {
            const errorBody: Record<string, string> = {
              message: err.message,
              code: err.code,
            };
            if (err.statusCode !== undefined) {
              errorBody.httpCode = String(err.statusCode);
            }
            throw new NodeApiError(this.getNode(), {
              ...errorBody,
            });
          }
          throw err;
        }

        returnData.push(...toItems(result, i));
      } catch (err) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: err instanceof Error ? err.message : String(err) },
            pairedItem: { item: i },
          });
          continue;
        }
        throw err;
      }
    }

    return [returnData];
  }
}
