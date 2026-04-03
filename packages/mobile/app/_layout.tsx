import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { SessionRuntimeBridge } from '../src/features/auth/SessionRuntimeBridge'
import { SessionControllerProvider } from '../src/features/auth/session-store'

const lightShellTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#f8fafc',
    border: '#dbe2ea',
    card: '#ffffff',
    notification: '#2563eb',
    primary: '#0f172a',
    text: '#0f172a',
  },
}

const darkShellTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0f172a',
    border: '#1f2937',
    card: '#111827',
    notification: '#38bdf8',
    primary: '#38bdf8',
    text: '#f8fafc',
  },
}

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const theme = colorScheme === 'light' ? lightShellTheme : darkShellTheme
  const statusBarStyle = colorScheme === 'light' ? 'dark' : 'light'

  return (
    <SafeAreaProvider>
      <SessionControllerProvider>
        <ThemeProvider value={theme}>
          <StatusBar style={statusBarStyle} />
          <SessionRuntimeBridge />
          <Stack
            screenOptions={{
              animation: 'fade',
              contentStyle: { backgroundColor: theme.colors.background },
              headerShown: false,
            }}
          />
        </ThemeProvider>
      </SessionControllerProvider>
    </SafeAreaProvider>
  )
}
