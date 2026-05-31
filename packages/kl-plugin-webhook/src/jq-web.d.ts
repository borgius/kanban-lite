/**
 * Ambient module declaration for `jq-web`.
 *
 * `jq-web` ships no TypeScript types. Both the original `jq-web` build (the
 * module export is a thenable resolving to the jq instance) and the
 * `stainless-api/jq-web` fork (the default export is an async init function)
 * are supported by the loader in `transform.ts`, so the declaration keeps the
 * export shape intentionally loose.
 */
declare module 'jq-web' {
  const jqWeb: unknown
  export default jqWeb
}
