import { useTheme } from '@react-navigation/native'
import { CameraView, useCameraPermissions, type BarcodeScanningResult, type BarcodeType } from 'expo-camera'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import {
  consumeQrScanOnce,
  requestQrScannerPermission,
} from '../../src/features/auth/qr-scanner'
import { useSessionController } from '../../src/features/auth/session-store'

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
              colors={colors}
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

type AuthQrScannerPanelProps = {
  colors: {
    border: string
    card: string
    primary: string
    text: string
  }
  onCancel: () => void
  onDenied: () => void
  onScan: (entryInput: string) => void
  onShowManualEntry: () => void
}

const QR_BARCODE_SCANNER_SETTINGS: { barcodeTypes: BarcodeType[] } = {
  barcodeTypes: ['qr'],
}

function AuthQrScannerPanel({
  colors,
  onCancel,
  onDenied,
  onScan,
  onShowManualEntry,
}: AuthQrScannerPanelProps) {
  const [permission, requestPermission] = useCameraPermissions()
  const [mountError, setMountError] = useState<string | null>(null)
  const scanLock = useRef({ current: false })

  const handleRequestPermission = async () => {
    const outcome = await requestQrScannerPermission(requestPermission)
    if (outcome === 'denied') {
      onDenied()
    }
  }

  const handleBarcodeScanned = ({ data }: Pick<BarcodeScanningResult, 'data'>) => {
    consumeQrScanOnce(scanLock.current, data, onScan)
  }

  if (!permission) {
    return (
      <View style={[styles.scannerPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Preparing camera…</Text>
          <Text style={[styles.body, { color: colors.text }]}>The QR result still goes through the same workspace and session validation pipeline.</Text>
        </View>
        <Pressable onPress={onCancel} style={[styles.secondaryButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
        </Pressable>
      </View>
    )
  }

  if (mountError) {
    return (
      <View style={[styles.scannerPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Camera preview unavailable</Text>
        <Text style={[styles.body, { color: colors.text }]}>{mountError}</Text>
        <View style={styles.buttonRow}>
          <Pressable onPress={onShowManualEntry} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Paste link instead</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  if (!permission.granted) {
    const isPermissionPermanentlyDenied = permission.canAskAgain === false

    return (
      <View style={[styles.scannerPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Scan the sign-in QR code</Text>
        <Text style={[styles.body, { color: colors.text }]}>Point the camera at your workspace QR code to continue through the existing secure mobile onboarding checks.</Text>
        <View style={styles.buttonRow}>
          <Pressable
            onPress={isPermissionPermanentlyDenied ? onDenied : () => {
              void handleRequestPermission()
            }}
            style={[styles.primaryButton, styles.flexButton, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.primaryButtonText}>{isPermissionPermanentlyDenied ? 'Use paste fallback' : 'Allow camera access'}</Text>
          </Pressable>
          <Pressable onPress={onCancel} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
          </Pressable>
        </View>
        {!isPermissionPermanentlyDenied ? (
          <Pressable onPress={onShowManualEntry} style={[styles.linkButton, { borderColor: colors.border }]}>
            <Text style={[styles.linkButtonText, { color: colors.text }]}>Paste the link instead.</Text>
          </Pressable>
        ) : null}
      </View>
    )
  }

  return (
    <View style={[styles.scannerPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.previewFrame}>
        <CameraView
          barcodeScannerSettings={QR_BARCODE_SCANNER_SETTINGS}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          onMountError={(event) => {
            setMountError(event.message || 'Camera preview is unavailable on this device.')
          }}
          style={styles.cameraPreview}
        />
        <View pointerEvents="none" style={styles.previewOverlay}>
          <View style={styles.scanGuide} />
        </View>
      </View>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Align the QR code inside the frame</Text>
      <Text style={[styles.body, { color: colors.text }]}>The first valid scan wins. If you need to try again, reopen the scanner or paste the link manually.</Text>
      <View style={styles.buttonRow}>
        <Pressable onPress={onShowManualEntry} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Paste link instead</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={[styles.secondaryButton, styles.flexButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  )
}

type CredentialsFormProps = {
  colors: {
    border: string
    primary: string
    text: string
  }
  pendingTarget: string | null
  resolvedWorkspaceOrigin: string
  onBack: () => void
  onSubmit: (username: string, password: string) => void
}

function CredentialsForm({
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
  },
  card: {
    flexGrow: 1,
    borderRadius: 28,
    borderWidth: 1,
    padding: 24,
    gap: 18,
  },
  eyebrow: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  multilineInput: {
    minHeight: 112,
    textAlignVertical: 'top',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  linkButton: {
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  linkButtonText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  },
  divider: {
    backgroundColor: '#cbd5e1',
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  inlineSection: {
    gap: 12,
  },
  banner: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  scannerPanel: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  bannerTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  bannerMessage: {
    fontSize: 15,
    lineHeight: 22,
  },
  busyState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  loadingState: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  busyTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  busyBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  workspaceSummary: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 16,
  },
  workspaceSummaryLabel: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  workspaceSummaryValue: {
    fontSize: 15,
    fontWeight: '700',
  },
  note: {
    fontSize: 14,
    lineHeight: 20,
  },
  previewFrame: {
    backgroundColor: '#020617',
    borderRadius: 18,
    minHeight: 280,
    overflow: 'hidden',
    position: 'relative',
  },
  cameraPreview: {
    flex: 1,
    minHeight: 280,
  },
  previewOverlay: {
    alignItems: 'center',
    inset: 0,
    justifyContent: 'center',
    position: 'absolute',
  },
  scanGuide: {
    borderColor: 'rgba(248, 250, 252, 0.9)',
    borderRadius: 24,
    borderWidth: 2,
    height: 180,
    width: 180,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  flexButton: {
    flex: 1,
  },
  footnote: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 20,
  },
})