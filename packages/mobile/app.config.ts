import type { ExpoConfig, ConfigContext } from 'expo/config'

type AppVariant = 'development' | 'preview' | 'production'

const DEFAULT_VARIANT: AppVariant = 'development'
const BASE_PACKAGE = 'io.github.borgius.kanbanlite.mobile'
const BASE_SCHEME = 'kanbanlite-mobile'

function getAppVariant(): AppVariant {
  const value = process.env.APP_VARIANT
  if (value === 'development' || value === 'preview' || value === 'production') {
    return value
  }
  return DEFAULT_VARIANT
}

function getVariantLabel(variant: AppVariant): string {
  switch (variant) {
    case 'development':
      return 'Dev'
    case 'preview':
      return 'Preview'
    case 'production':
      return 'Production'
  }
}

function getPackageSuffix(variant: AppVariant): string {
  switch (variant) {
    case 'development':
      return '.dev'
    case 'preview':
      return '.preview'
    case 'production':
      return ''
  }
}

function getScheme(variant: AppVariant): string {
  switch (variant) {
    case 'development':
      return `${BASE_SCHEME}-dev`
    case 'preview':
      return `${BASE_SCHEME}-preview`
    case 'production':
      return BASE_SCHEME
  }
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = getAppVariant()
  const packageSuffix = getPackageSuffix(variant)
  const label = getVariantLabel(variant)
  const scheme = getScheme(variant)

  return {
    ...config,
    name: variant === 'production' ? 'Kanban Lite Mobile' : `Kanban Lite Mobile (${label})`,
    description: 'Field-worker mobile shell for Kanban Lite.',
    slug: 'kanban-lite-mobile',
    scheme,
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-camera',
        {
          cameraPermission: 'Allow $(PRODUCT_NAME) to scan workspace sign-in QR codes.',
          recordAudioAndroid: false,
          barcodeScannerEnabled: true,
        },
      ],
    ],
    experiments: {
      typedRoutes: true
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: `${BASE_PACKAGE}${packageSuffix}`
    },
    android: {
      package: `${BASE_PACKAGE}${packageSuffix}`,
      predictiveBackGestureEnabled: false
    },
    extra: {
      appVariant: variant,
      deepLinkScheme: scheme,
      runtimeBoundary: 'rest-only'
    }
  }
}
