import type { ConfigStorageFailure, KanbanConfig } from './config';
import type { CloudflareWorkerProviderContext } from '../sdk/env';

export interface RuntimeHostRawConfigDocument extends Record<string, unknown> {
	version?: 1 | KanbanConfig['version'];
	defaultBoard?: KanbanConfig['defaultBoard'];
	kanbanDirectory?: KanbanConfig['kanbanDirectory'];
	boards?: Record<string, unknown>;
	storageEngine?: KanbanConfig['storageEngine'];
	sqlitePath?: KanbanConfig['sqlitePath'];
	plugins?: KanbanConfig['plugins'];
}

export type RuntimeHostConfigDocument = KanbanConfig | RuntimeHostRawConfigDocument;
export type RuntimeHostConfigSelection = Pick<RuntimeHostRawConfigDocument, 'storageEngine' | 'sqlitePath' | 'plugins'>;
export type RuntimeHostConfigRepositoryReadResult = {
	status: 'ok';
	value: RuntimeHostConfigDocument;
	providerId?: string;
} | {
	status: 'missing';
	providerId?: string;
} | {
	status: 'error';
	reason: 'read' | 'parse';
	cause: unknown;
	providerId?: string;
};
export type RuntimeHostConfigRepositoryWriteResult = {
	status: 'ok';
	providerId?: string;
} | {
	status: 'error';
	cause: unknown;
	providerId?: string;
};

export interface RuntimeHost {
	readConfig?(workspaceRoot: string, filePath: string): RuntimeHostConfigDocument | undefined;
	writeConfig?(workspaceRoot: string, filePath: string, config: RuntimeHostConfigDocument): boolean;
	readConfigRepositoryDocument?(workspaceRoot: string, filePath: string): RuntimeHostConfigRepositoryReadResult | undefined;
	writeConfigRepositoryDocument?(workspaceRoot: string, filePath: string, config: RuntimeHostConfigDocument): RuntimeHostConfigRepositoryWriteResult | undefined;
	assertCanWriteConfig?(workspaceRoot: string, filePath: string, config: RuntimeHostConfigDocument): void;
	getConfigStorageFailure?(workspaceRoot: string, config: RuntimeHostConfigSelection): ConfigStorageFailure | null | undefined;
	loadWorkspaceEnv?(workspaceRoot: string): boolean;
	resolveExternalModule?(request: string): unknown;
	getCloudflareWorkerProviderContext?(): CloudflareWorkerProviderContext | null | undefined;
}

export declare function installRuntimeHost(host: RuntimeHost | null): void;
export declare function getRuntimeHost(): RuntimeHost | null;
export declare function resetRuntimeHost(): void;
/**
 * Loads workspace-local environment variables from `<workspaceRoot>/.env`.
 *
 * Existing `process.env` values win, so explicit shell/CI variables still override
 * local defaults. The same file is parsed at most once per process.
 */
export declare function loadWorkspaceEnv(workspaceRoot: string): void;
