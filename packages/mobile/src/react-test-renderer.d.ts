declare module 'react-test-renderer' {
  import type { ReactElement } from 'react'

  export type ReactTestRenderer = {
    root: {
      findByProps(props: Record<string, unknown>): {
        props: Record<string, unknown>
      }
    }
    unmount(): void
  }

  export function create(element: ReactElement): ReactTestRenderer

  export function act<T>(callback: () => T | Promise<T>): Promise<void>

  const TestRenderer: {
    create: typeof create
    act: typeof act
  }

  export default TestRenderer
}
