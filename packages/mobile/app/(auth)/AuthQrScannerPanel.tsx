import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
  type BarcodeType,
} from 'expo-camera'
import { useRef, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

import {
  consumeQrScanOnce,
  requestQrScannerPermission,
} from '../../src/features/auth/qr-scanner'
import { styles } from './auth-screen.styles'
import type { AuthScannerColors } from './auth-screen.types'

type AuthQrScannerPanelProps = {
  colors: AuthScannerColors
  onCancel: () => void
  onDenied: () => void
  onScan: (entryInput: string) => void
  onShowManualEntry: () => void
}

const QR_BARCODE_SCANNER_SETTINGS: { barcodeTypes: BarcodeType[] } = {
  barcodeTypes: ['qr'],
}

export function AuthQrScannerPanel({
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
