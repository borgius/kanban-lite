import type { Card } from '../shared/types';
/**
 * Parses a markdown file with YAML frontmatter into a Card object.
 *
 * The file is expected to have a YAML frontmatter block delimited by `---` at the
 * top, followed by the card body content. Additional `---` delimited blocks after
 * the body are parsed as comment sections (if they contain `comment: true`),
 * otherwise they are treated as part of the body content.
 *
 * @param content - The raw string content of the markdown file.
 * @param filePath - The absolute file path, used to extract the card ID from the filename
 *   if no `id` field is present in the frontmatter.
 * @returns The parsed {@link Card} object, or `null` if no valid frontmatter block is found.
 */
export declare function parseCardFile(content: string, filePath: string): Card | null;
/**
 * Serializes a Card object back to markdown with YAML frontmatter.
 *
 * Produces a string with a `---` delimited YAML frontmatter block containing all
 * card metadata, followed by the card body content. Any comments attached to the
 * card are appended as additional `---` delimited sections at the end of the file.
 *
 * @param card - The {@link Card} object to serialize.
 * @returns The complete markdown string ready to be written to a `.md` file.
 */
export declare function serializeCard(card: Card): string;
