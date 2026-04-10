import { useTheme } from '@react-navigation/native'
import { useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { useSessionController } from '../../src/features/auth/session-store'
import { AuthQrScannerPanel } from './AuthQrScannerPanel'
import { CredentialsForm } from './CredentialsForm'
import { styles } from './auth-screen.styles'

export default function AuthScreen() {
  const { colors } = useTheme()
  const { controller, state } = useSessionController()
  const [entryInput, setEntryInput] = useState('')
  const [showEntryInput, setShowEntryInput] = useState(false)
  const [showQrScanner, setShowQrScanner] = useState(false)
  const credentialScope = state.resolvedWorkspaceOrigin ?? 'workspace-entry'

  const submitWorkspace = () => {
    setEntryInput('')
    setShowEntryInput(false)
    setShowQrScanner(false)
    void controller.submitWorkspace(state.workspaceInput)
  }

  const submitEntry = () => {
    if (!entryInput.trim()) {
      return
    }

    setShowQrScanner(false)
    void controller.handleIncomingEntry(entryInput, 'qr')
    setEntryInput('')
    setShowEntryInput(false)
  }

  const openEntryInput = () => {
    setShowQrScanner(false)
    setShowEntryInput(true)
  }

  const openQrScanner = () => {
    setShowEntryInput(false)
    setShowQrScanner(true)
  }

  const cancelQrScanner = () => {
    setShowQrScanner(false)
    setEntryInput('')
    controller.handleQrOutcome('cancelled')
  }

  const denyQrScanner = () => {
    setShowQrScanner(false)
    setShowEntryInput(true)
    controller.handleQrOutcome('denied')
  }

  const handleQrScan = (value: string) => {
    setShowQrScanner(false)
    void controller.handleIncomingEntry(value, 'qr')
  }

  const submitCredentials = (username: string, password: string) => {
    void controller.submitCredentials({ username, password })
  }

  const isBusy = state.phase === 'restoring' || state.phase === 'signing-in'
  const hasResolvedWorkspace = Boolean(state.resolvedWorkspaceOrigin)
  const bannerAccent = state.banner?.kind === 'error' ? '#dc2626' : colors.primary

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>MF8 auth and onboarding shell</Text>
          <Text style={[styles.title, { color: colors.text }]}>Kanban Lite Mobile</Text>
          <Text style={[styles.body, { color: colors.text }]}>Enter your workspace, sign in with local credentials, or continue from a mobile sign-in link.</Text>

          {state.banner ? (
            <View style={[styles.banner, { borderColor: bannerAccent, backgroundColor: `${bannerAccent}14` }]}>
              <Text style={[styles.bannerTitle, { color: bannerAccent }]}>{state.banner.kind === 'error' ? 'Needs attention' : 'Heads up'}</Text>
              <Text style={[styles.bannerMessage, { color: colors.text }]}>{state.banner.message}</Text>
            </View>
          ) : null}

          {isBusy ? (
            <View style={styles.busyState}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={[styles.busyTitle, { color: colors.text }]}>{state.statusMessage ?? 'Checking session…'}</Text>
              <Text style={[styles.busyBody, { color: colors.text }]}>Protected work stays hidden until the current workspace and session are revalidated.</Text>
            </View>
          ) : null}

          {!isBusy && state.phase === 'authenticated' ? (
            <View style={styles.section}>
              <View style={styles.chipRow}>
                <View style={[styles.chip, { borderColor: colors.border }]}>
                  <Text style={[styles.chipLabel, { color: colors.text }]}>{state.sessionStatus?.workspaceOrigin}</Text>
                </View>
                <View style={[styles.chip, { borderColor: colors.border }]}>
                  <Text style={[styles.chipLabel, { color: colors.text }]}>{state.sessionStatus?.subject}</Text>
                </View>
              </View>
              <Text style={[styles.body, { color: colors.text }]}>Session restore is validated. The protected workfeed will mount on top of this no-stale-flash gate in the next task wave.</Text>
              {state.pendingTarget ? (
                <Text style={[styles.note, { color: colors.text }]}>Queued target: {state.pendingTarget}</Text>
              ) : null}
              <View style={styles.buttonRow}>
                <Pressable onPress={() => void controller.logout()} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
                  <Text style={styles.primaryButtonText}>Sign out</Text>
                </Pressable>
                <Pressable onPress={controller.resetWorkspace} style={[styles.secondaryButton, { borderColor: colors.border }]}>
                  <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Change workspace</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {!isBusy && state.phase !== 'authenticated' ? (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Workspace entry</Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={controller.setWorkspaceInput}
                placeholder="https://field.example.com/mobile"
                placeholderTextColor="#94a3b8"
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                value={state.workspaceInput}
              />
              <Pressable onPress={submitWorkspace} style={[styles.primaryButton, { backgroundColor: colors.primary }]}>
                <Text style={styles.primaryButtonText}>Continue</Text>
              </Pressable>

              <View style={styles.divider} />

              <Text style={[styles.sectionTitle, { color: colors.text }]}>Deep link or QR entry</Text>
              <Text style={[styles.body, { color: colors.text }]}>Scan the mobile sign-in QR code or paste the link into the same onboarding pipeline and validation flow.</Text>
              {showQrScanner ? (
                <AuthQrScannerPanel
                  colors={{
                    border: colors.border,
                    card: colors.card,
                    primary: colors.primary,
                    text: colors.text,
                  }}
                  onCancel={cancelQrScanner}
                  onDenied={denyQrScanner}
                  onScan={handleQrScan}
                  onShowManualEntry={openEntryInput}
                />
              ) : showEntryInput ? (
                <View style={styles.inlineSection}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    onChangeText={setEntryInput}
                    placeholder="kanbanlite-mobile://open?workspaceOrigin=…"
                    placeholderTextColor="#94a3b8"
                    style={[styles.input, styles.multilineInput, { borderColor: colors.border, color: colors.text }]}
                    value={entryInput}
                  />
                  <View style={styles.buttonRow}>
                    <Pressable onPress={submitEntry} style={[styles.primaryButton, styles.flexButton, { backgroundColor: colors.primary }]}>
                      <Text style={styles.primaryButtonText}>Use pasted entry</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        setShowEntryInput(false)
                        setEntryInput('')
                        controller.handleQrOutcome('cancelled')
                      }}
                      style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
                    </Pressable>
                  </View>
                  <Pressable
                    onPress={() => {
                      setShowEntryInput(false)
                      setEntryInput('')
                      controller.handleQrOutcome('denied')
                    }}
                    style={[styles.linkButton, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.linkButtonText, { color: colors.text }]}>Camera access denied? Paste the link instead.</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.buttonRow}>
                  <Pressable onPress={openQrScanner} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
                    <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Scan QR code</Text>
                  </Pressable>
                  <Pressable onPress={openEntryInput} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
                    <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Paste link or payload</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : null}

          {!isBusy && state.phase === 'credentials' && hasResolvedWorkspace ? (
            <CredentialsForm
              key={credentialScope}
              colors={{
                border: colors.border,
                primary: colors.primary,
                text: colors.text,
              }}
              pendingTarget={state.pendingTarget}
              resolvedWorkspaceOrigin={state.resolvedWorkspaceOrigin}
              onBack={controller.resetWorkspace}
              onSubmit={submitCredentials}
            />
          ) : null}

          <Text style={styles.footnote}>Mobile persists only the resolved workspace identity, the opaque mobile session token, and safe subject metadata. Browser cookies stay browser-only.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
