import type { ExpoConfig } from 'expo/config';

export default (): ExpoConfig => ({
  name: 'Shotloom', slug: 'shotloom-native', version: '0.9.14', scheme: 'shotloom-preview',
  platforms: ['ios', 'android'], orientation: 'default', userInterfaceStyle: 'light',
  ios: { bundleIdentifier: 'com.shotloom.app.preview', supportsTablet: true },
  android: {
    package: 'com.shotloom.app.preview', versionCode: 15,
    icon: './assets/android-icon.png',
    adaptiveIcon: { foregroundImage: './assets/android-icon-foreground.png', backgroundColor: '#B5A8FF', monochromeImage: './assets/android-icon-monochrome.png' },
  },
  plugins: ['expo-localization', 'expo-sharing', 'expo-web-browser', 'expo-secure-store'],
});
