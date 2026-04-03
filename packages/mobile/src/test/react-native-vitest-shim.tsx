import React from 'react'
import * as ReactNativeWeb from 'react-native-web'

function renderWithView(props: Record<string, unknown>, children?: React.ReactNode) {
  const View = ReactNativeWeb.View as React.ComponentType<Record<string, unknown>>
  return React.createElement(View, props, children)
}

const refreshControlFallback = ({ children, ...props }: { children?: React.ReactNode }) => {
  return renderWithView(props, children)
}

const modalFallback = ({ children, visible = true, ...props }: {
  children?: React.ReactNode
  visible?: boolean
}) => {
  if (!visible) {
    return null
  }

  return renderWithView(props, children)
}

export * from 'react-native-web'

export const Alert = {
  alert: () => undefined,
}

export const Modal = ('Modal' in ReactNativeWeb
  ? (ReactNativeWeb as Record<string, unknown>).Modal
  : modalFallback) as React.ComponentType<Record<string, unknown>>

export const RefreshControl = ('RefreshControl' in ReactNativeWeb
  ? (ReactNativeWeb as Record<string, unknown>).RefreshControl
  : refreshControlFallback) as React.ComponentType<Record<string, unknown>>
