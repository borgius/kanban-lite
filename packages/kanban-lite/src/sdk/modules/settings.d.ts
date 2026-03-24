import type { CardDisplaySettings } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Returns the global card display settings for the workspace.
 */
export declare function getSettings(ctx: SDKContext): CardDisplaySettings;
/**
 * Updates the global card display settings for the workspace.
 */
export declare function updateSettings(ctx: SDKContext, { settings }: {
    settings: CardDisplaySettings;
}): void;
/**
 * Sets the default board for the workspace.
 */
export declare function setDefaultBoard(ctx: SDKContext, { boardId }: {
    boardId: string;
}): void;
