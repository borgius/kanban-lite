import { AuthError } from '../sdk/types'

import { main } from './cli-main'
import { red } from './output'
import { handleAuthError } from './shared'

void main().catch((error) => {
  if (error instanceof AuthError) {
    handleAuthError(error)
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(red(`Error: ${message}`))
  process.exit(1)
})
