/**
 * Loads workspace-local environment variables from `<workspaceRoot>/.env`.
 *
 * Existing `process.env` values win, so explicit shell/CI variables still override
 * local defaults. The same file is parsed at most once per process.
 */
export declare function loadWorkspaceEnv(workspaceRoot: string): void;
