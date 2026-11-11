import { App as AntApp, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useSyncExternalStore } from 'react';
import { useLanguage } from '@/shared/i18n/use-translation.ts';
import { EditorPage } from './editor/editor-page.tsx';
import { NoticeBridge } from './providers/notice-bridge.tsx';
import { editorThemeConfig, getEditorTheme, onEditorThemeChange } from './providers/theme.ts';

/** Re-render the shell when the desk theme changes (URL, host session or the settings panel). */
function useEditorTheme() {
    return useSyncExternalStore((listener) => onEditorThemeChange(listener), getEditorTheme, getEditorTheme);
}

export function App() {
    const language = useLanguage();
    const theme = useEditorTheme();
    return (
        <ConfigProvider locale={language === 'en' ? enUS : zhCN} theme={editorThemeConfig(theme)}>
            <AntApp message={{ maxCount: 3 }}>
                <NoticeBridge />
                <EditorPage />
            </AntApp>
        </ConfigProvider>
    );
}
