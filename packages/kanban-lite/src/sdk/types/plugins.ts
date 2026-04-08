import type { KanbanSDK } from '../KanbanSDK'
import type { SDKPluginEventDeclaration } from './events'

export type CliPluginSdk = KanbanSDK

/**
 * Runtime context supplied to a {@link KanbanCliPlugin} when it is invoked by
 * the `kl` CLI.
 */
export interface CliPluginContext {
  /** Absolute path to the workspace root that contains `.kanban.json`. */
  workspaceRoot: string
  /**
   * Resolved SDK instance for the current workspace.
   *
   * Present when the plugin is invoked through the core `kl` CLI.
   * Absent in isolated unit tests or standalone invocations.
   * Plugins may use the full public {@link KanbanSDK} contract here, including
   * extension lookup and `getConfigSnapshot()`, instead of relying on older
   * helper-only SDK facades. Plugins should prefer this over constructing their
   * own SDK so that SDK-level auth policy is honoured.
   */
  sdk?: KanbanSDK
  /**
   * Core-owned CLI auth helper.
   *
   * Wraps mutating SDK calls with the CLI auth context derived from the
   * environment (`KANBAN_LITE_TOKEN` / `KANBAN_TOKEN`).  Use this instead
   * of calling SDK methods directly from CLI plugins so authentication and
   * policy enforcement are handled by core.
   */
  runWithCliAuth?: <T>(fn: () => Promise<T>) => Promise<T>
}

/**
 * Optional CLI extension that a plugin package may export as the named export
 * `cliPlugin`.
 *
 * When the `kl` CLI resolves a top-level command that matches the plugin's
 * {@link command} namespace (and no built-in handler claims it), or when a
 * built-in handler encounters an unknown sub-command, it delegates to
 * {@link run}.
 *
 * @example
 * ```typescript
 * // exported from the plugin package as `export const cliPlugin`
 * export const cliPlugin: KanbanCliPlugin = {
 *   manifest: { id: 'my-plugin' },
 *   command: 'auth',
 *   async run(subArgs, flags, context) {
 *     // handle sub-commands
 *   },
 * }
 * ```
 */
export interface KanbanCliPlugin {
  /** Plugin manifest identifying this extension. */
  readonly manifest: { readonly id: string }
  /**
   * Top-level CLI namespace owned by this plugin (e.g. `"auth"`).
   * Must match the first positional argument after `kl`.
   */
  readonly command: string
  /**
   * Optional compatibility aliases that should route to {@link command}.
   *
   * Useful for preserving historical shorthand command names after ownership
   * moves fully into a plugin package.
   */
  readonly aliases?: readonly string[]
  /**
   * Execute the plugin CLI command.
   *
   * @param subArgs  Positional arguments after the top-level command token.
   * @param flags    Parsed flag map (`string | boolean` values).
   * @param context  Runtime context including the workspace root path.
   */
  run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: CliPluginContext,
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// SDK extension plugin contract
// ---------------------------------------------------------------------------

/**
 * Optional SDK extension pack contributed by a plugin package.
 *
 * Plugins may export `sdkExtensionPlugin` to contribute named SDK methods or
 * capabilities to the active SDK instance. Extensions are loaded alongside the
 * plugin's capability providers and become accessible through
 * `sdk.getExtension(id)` or the `sdk.extensions` bag (SPE-02).
 *
 * **Authoring rules:**
 * - `manifest.id` should match the plugin's npm package name by convention.
 * - `extensions` must contain plain values or async functions — no class
 *   instances with hidden side-effecting constructors.
 * - This export is fully optional; plugins that omit it do not appear in the
 *   resolved `sdkExtensions` array and no existing capability exports change.
 *
 * @typeParam T - Shape of the named SDK extensions contributed by this plugin.
 */
export interface SDKExtensionPlugin<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Plugin manifest identifying this extension contribution. */
  readonly manifest: { readonly id: string; readonly provides: readonly string[] }
  /**
   * Optional discoverable event declarations contributed by this plugin.
   * These surface through `sdk.listAvailableEvents()` when the plugin is active.
   */
  readonly events?: readonly SDKPluginEventDeclaration[]
  /**
   * Named SDK methods or capabilities contributed by this plugin.
   * Accessible through `sdk.getExtension(manifest.id)` after capability resolution.
   */
  readonly extensions: T
}

/**
 * Resolved entry in the SDK extensions bag populated during capability bag resolution.
 *
 * Each entry corresponds to one active plugin package that exported
 * `sdkExtensionPlugin`. Consumed by `KanbanSDK.getExtension(id)` (SPE-02) and
 * the future `sdk.extensions` named-access bag.
 *
 * @typeParam T - Shape of the SDK extensions contributed by the owning plugin.
 */
export interface SDKExtensionLoaderResult<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Plugin id matching the contributing plugin's `manifest.id`. */
  readonly id: string
  /** Optional discoverable event declarations contributed by the owning plugin. */
  readonly events: readonly SDKPluginEventDeclaration[]
  /** Resolved SDK methods/capabilities from the plugin. */
  readonly extensions: T
}
