import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

import { styles } from './auth-screen.styles'
import type { AuthSurfaceColors } from './auth-screen.types'

type CredentialsFormProps = {
  colors: AuthSurfaceColors
  pendingTarget: string | null
  resolvedWorkspaceOrigin: string
  onBack: () => void
  onSubmit: (username: string, password: string) => void
}

export function CredentialsForm({
  colors,
  pendingTarget,
  resolvedWorkspaceOrigin,
  onBack,
  onSubmit,
}: CredentialsFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Local sign-in</Text>
      <View style={[styles.workspaceSummary, { borderColor: colors.border }]}>
        <Text style={[styles.workspaceSummaryLabel, { color: colors.primary }]}>Resolved workspace</Text>
        <Text style={[styles.workspaceSummaryValue, { color: colors.text }]}>{resolvedWorkspaceOrigin}</Text>
        {pendingTarget ? (
          <Text style={[styles.note, { color: colors.text }]}>Pending target: {pendingTarget}</Text>
        ) : null}
      </View>
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setUsername}
        placeholder="Username"
        placeholderTextColor="#94a3b8"
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
        value={username}
      />
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor="#94a3b8"
        secureTextEntry
        style={[styles.input, { borderColor: colors.border, color: colors.text }]}
        value={password}
      />
      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => onSubmit(username, password)}
          style={[styles.primaryButton, styles.flexButton, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.primaryButtonText}>Sign in</Text>
        </Pressable>
        <Pressable onPress={onBack} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Use another workspace</Text>
        </Pressable>
      </View>
    </View>
  )
}
