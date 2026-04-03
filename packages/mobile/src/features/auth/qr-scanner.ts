export type QrScanLock = {
  current: boolean
}

export type CameraPermissionRequest = () => Promise<{
  granted: boolean
}>

export function consumeQrScanOnce(
  scanLock: QrScanLock,
  entryInput: string,
  onAcceptedScan: (entryInput: string) => void,
): boolean {
  if (scanLock.current) {
    return false
  }

  scanLock.current = true
  onAcceptedScan(entryInput)
  return true
}

export function resetQrScanLock(scanLock: QrScanLock): void {
  scanLock.current = false
}

export async function requestQrScannerPermission(
  requestPermission: CameraPermissionRequest,
): Promise<'granted' | 'denied'> {
  const result = await requestPermission()
  return result.granted ? 'granted' : 'denied'
}
