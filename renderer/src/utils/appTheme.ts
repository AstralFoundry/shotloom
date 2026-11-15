export type ThemePreference = 'light' | 'dark' | 'system';
export type AppTheme = 'light' | 'dark';
export type ThemeOrigin = { x: number; y: number };

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'system' ? value : 'light';
}

export function resolveAppTheme(preference: ThemePreference, systemDark: boolean): AppTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}
