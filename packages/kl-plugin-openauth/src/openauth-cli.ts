import * as fs from 'node:fs'
import * as path from 'node:path'
import type { KanbanCliPlugin, CliPluginContext } from 'kanban-lite/sdk'
import { hashPassword } from './openauth-issuer'

export const cliPlugin: KanbanCliPlugin = {
  manifest: { id: 'kl-plugin-openauth' },
  command: 'openauth',
  async run(
    subArgs: string[],
    flags: Record<string, string | boolean | string[]>,
    context: CliPluginContext,
  ): Promise<void> {
    const sub = subArgs[0]

    if (sub === 'add-user') {
      const email = flags.email as string | undefined
      const password = flags.password as string | undefined
      const role = flags.role as string | undefined

      if (!email || !password) {
        console.error(
          'Usage: kl openauth add-user --email <email> --password <pass> [--role <role>]',
        )
        process.exit(1)
      }

      const cfgPath = path.join(context.workspaceRoot, '.kanban.json')
      const raw = await fs.promises.readFile(cfgPath, 'utf-8')
      const cfg = JSON.parse(raw) as Record<string, unknown>

      // Navigate into plugins["auth.identity"].options.embeddedIssuer.password.users
      const plugins =
        typeof cfg.plugins === 'object' && cfg.plugins !== null
          ? (cfg.plugins as Record<string, unknown>)
          : {}
      const identity =
        typeof plugins['auth.identity'] === 'object' && plugins['auth.identity'] !== null
          ? (plugins['auth.identity'] as Record<string, unknown>)
          : {}
      const options =
        typeof identity.options === 'object' && identity.options !== null
          ? (identity.options as Record<string, unknown>)
          : {}
      const embeddedIssuer =
        typeof options.embeddedIssuer === 'object' && options.embeddedIssuer !== null
          ? (options.embeddedIssuer as Record<string, unknown>)
          : {}
      const passwordSection =
        typeof embeddedIssuer.password === 'object' && embeddedIssuer.password !== null
          ? (embeddedIssuer.password as Record<string, unknown>)
          : {}
      const users = (
        Array.isArray(passwordSection.users) ? [...passwordSection.users] : []
      ) as Array<Record<string, unknown>>

      const existingIdx = users.findIndex(
        u => typeof u.email === 'string' && u.email.toLowerCase() === email.toLowerCase(),
      )

      const passwordHash = await hashPassword(password)

      if (existingIdx >= 0) {
        const prev = users[existingIdx]
        // Replace entry: keep email, update hash, keep/override role, remove any legacy plain-text password
        users[existingIdx] = {
          email: prev.email,
          passwordHash,
          ...(role ? { role } : prev.role ? { role: prev.role } : {}),
        }
        console.log(`User "${email}" updated.`)
      } else {
        const newEntry: Record<string, unknown> = { email, passwordHash }
        if (role) newEntry.role = role
        users.push(newEntry)
        console.log(`User "${email}" added.`)
      }

      passwordSection.users = users
      embeddedIssuer.password = passwordSection
      options.embeddedIssuer = embeddedIssuer
      identity.options = options
      plugins['auth.identity'] = identity
      cfg.plugins = plugins

      await fs.promises.writeFile(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf-8')
      return
    }

    console.error(`Unknown openauth sub-command: ${sub ?? '(none)'}`)
    console.error('Available sub-commands: add-user')
    process.exit(1)
  },
}
