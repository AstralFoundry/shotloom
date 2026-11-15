import { Segmented } from 'antd';
import { useRef } from 'react';
import { t } from '@/i18n';
import { normalizeThemePreference, type ThemePreference, type ThemeOrigin } from '../../utils/appTheme';
import { IconSymbol, type IconName } from './IconSymbol';

export function ThemeSwitch({ value, onChange }: { value: string; onChange: (value: ThemePreference, origin?: ThemeOrigin) => void }) {
  const origin = useRef<ThemeOrigin | undefined>(undefined);
  const modes: { value: ThemePreference; icon: IconName; label: string }[] = [
    { value: 'dark', icon: 'moon', label: t('settings.themeDark') },
    { value: 'light', icon: 'sun', label: t('settings.themeLight') },
    { value: 'system', icon: 'monitor', label: t('settings.themeSystem') },
  ];
  return <Segmented className="theme-switch" aria-label={t('settings.theme')} value={normalizeThemePreference(value)}
    onPointerDownCapture={event => { origin.current = { x: event.clientX, y: event.clientY }; }}
    onKeyDownCapture={event => { const rect = event.currentTarget.getBoundingClientRect(); origin.current = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }}
    onChange={next => onChange(normalizeThemePreference(next), origin.current)}
    options={modes.map(mode => ({ value: mode.value, label: <span className="theme-switch-icon" title={mode.label} aria-label={mode.label}><IconSymbol name={mode.icon} /></span> }))} />;
}
