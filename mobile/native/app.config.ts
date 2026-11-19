import type { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Shotloom Preview', slug: 'shotloom-native', version: '0.9.11', scheme: 'shotloom-preview',
  platforms: ['ios', 'android'], orientation: 'default', userInterfaceStyle: 'light',
  ios: { bundleIdentifier: 'com.shotloom.app.preview', supportsTablet: true },
  android: { package: 'com.shotloom.app.preview', versionCode: 12 },
  plugins: ['expo-localization', 'expo-sharing', 'expo-web-browser', 'expo-secure-store'],
});
