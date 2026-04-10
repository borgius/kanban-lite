import { StyleSheet } from 'react-native'

export const styles = StyleSheet.create({
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
