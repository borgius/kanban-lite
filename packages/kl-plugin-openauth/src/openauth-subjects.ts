import { object, string, optional } from 'valibot'
import { createSubjects } from '@openauthjs/openauth/subject'

/**
 * Default OpenAuth subject schema for Kanban Lite.
 *
 * The `user` subject carries `userID` (required) plus an optional `role`.
 * Users may supply a custom schema via plugin options; this default covers
 * the common password-flow and embedded-issuer case.
 */
export const subjects = createSubjects({
  user: object({
    userID: string(),
    role: optional(string()),
  }),
})

export type Subjects = typeof subjects
