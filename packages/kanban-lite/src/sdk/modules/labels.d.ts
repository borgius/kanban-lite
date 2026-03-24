import type { LabelDefinition, Card } from '../../shared/types';
import type { SDKContext } from './context';
/**
 * Returns all label definitions from the workspace configuration.
 */
export declare function getLabels(ctx: SDKContext): Record<string, LabelDefinition>;
/**
 * Creates or updates a label definition in the workspace configuration.
 */
export declare function setLabel(ctx: SDKContext, { name, definition }: {
    name: string;
    definition: LabelDefinition;
}): void;
/**
 * Removes a label definition and cascades the deletion to all cards.
 */
export declare function deleteLabel(ctx: SDKContext, { name }: {
    name: string;
}): Promise<void>;
/**
 * Renames a label in the configuration and cascades the change to all cards.
 */
export declare function renameLabel(ctx: SDKContext, { oldName, newName }: {
    oldName: string;
    newName: string;
}): Promise<void>;
/**
 * Returns a sorted list of label names that belong to the given group.
 */
export declare function getLabelsInGroup(ctx: SDKContext, { group }: {
    group: string;
}): string[];
/**
 * Returns all cards that have at least one label belonging to the given group.
 */
export declare function filterCardsByLabelGroup(ctx: SDKContext, { group, boardId }: {
    group: string;
    boardId?: string;
}): Promise<Card[]>;
