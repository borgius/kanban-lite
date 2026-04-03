import { describe, expect, it, vi } from 'vitest'

import {
  consumeQrScanOnce,
  requestQrScannerPermission,
  resetQrScanLock,
} from '../qr-scanner'

describe('qr scanner helpers', () => {
  it('submits only the first scanned QR payload until the scanner is reset', () => {
    const scanLock = { current: false }
    const onAcceptedScan = vi.fn()

    expect(consumeQrScanOnce(scanLock, 'first-qr', onAcceptedScan)).toBe(true)
    expect(consumeQrScanOnce(scanLock, 'second-qr', onAcceptedScan)).toBe(false)

    expect(onAcceptedScan).toHaveBeenCalledTimes(1)
    expect(onAcceptedScan).toHaveBeenCalledWith('first-qr')

    resetQrScanLock(scanLock)

    expect(consumeQrScanOnce(scanLock, 'third-qr', onAcceptedScan)).toBe(true)
    expect(onAcceptedScan).toHaveBeenCalledTimes(2)
    expect(onAcceptedScan).toHaveBeenLastCalledWith('third-qr')
  })

  it('maps a rejected permission request to the denied outcome', async () => {
    const requestPermission = vi.fn(async () => ({ granted: false }))

    await expect(requestQrScannerPermission(requestPermission)).resolves.toBe('denied')
    expect(requestPermission).toHaveBeenCalledTimes(1)
  })
})
