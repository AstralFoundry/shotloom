import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import defaults from '../../../renderer/src/config/shotloom-defaults.generated.json';
import type { MobileSettings } from '../../../shared/mobileSettings';
import type { ModelPublication } from '../../../shared/modelPublications';
import type { NativeApi } from './api';
import { colors, styles, Button, Icon } from './ui';
import { language, local, setLanguage, t } from './i18n';

type ModelKey = 'agentPreferredTextModel' | 'agentPreferredImageModel' | 'agentPreferredVideoModel';
const models = [
  ['agentPreferredTextModel', 'textGeneration', 'ui.SettingsPanel.text.b2a9e487'],
  ['agentPreferredImageModel', 'imageGeneration', 'ui.SettingsPanel.text.f581bd77'],
  ['agentPreferredVideoModel', 'videoGeneration', 'ui.SettingsPanel.text.5c293e15'],
] as const;
const toggles = [
  ['agentCanRunNodes', 'ui.SettingsPanel.text.0050c8d7', 'ui.SettingsPanel.text.a1c80c44'],
  ['agentAutoEval', 'ui.SettingsPanel.text.0d1c91aa', 'ui.SettingsPanel.text.1f7ccf1e'],
  ['agentAutoLayout', 'ui.SettingsPanel.text.c88a2b42', 'ui.SettingsPanel.text.0f0a2f0c'],
] as const;

export function NativeSettings({ api, onChanged }: { api: NativeApi; onChanged: () => void }) {
  const [settings, setSettings] = useState<MobileSettings>(() => api.cached('/settings/mobile') || {});
  const [catalog, setCatalog] = useState<{ publications: ModelPublication[] }>(() => api.cached('/models') || { publications: [] });
  const [loading, setLoading] = useState(!api.cached('/settings/mobile'));
  const [loaded, setLoaded] = useState(Boolean(api.cached('/settings/mobile')));
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [modelError, setModelError] = useState('');
  const [picker, setPicker] = useState<ModelKey>();
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState(false);
  const refresh = useCallback(async (force = false) => {
    setLoading(force || !api.cached('/settings/mobile')); setError(''); setModelError('');
    await Promise.all([
      api.read<MobileSettings>('/settings/mobile', force).then(value => { setSettings(value); setLoaded(true); }).catch(cause => setError(cause.message)),
      api.read<{ publications: ModelPublication[] }>('/models', force).then(setCatalog).catch(cause => setModelError(cause.message)),
    ]);
    setLoading(false);
  }, [api]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  const save = async (patch: MobileSettings) => {
    if (running.current || !loaded) return;
    running.current = true; setBusy(true); setError('');
    try {
      const value = await api.request<MobileSettings>('/settings/mobile', 'PATCH', patch);
      setSettings(value);
      if (value.locale) setLanguage(value.locale);
      onChanged(); setPicker(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(false); }
  };
  const diagnostics = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try {
      if (!await isAvailableAsync()) throw new Error(local('当前设备不支持分享文件。', 'File sharing is unavailable.'));
      const file = new File(Paths.cache, 'shotloom-native-diagnostics.json');
      file.create({ overwrite: true });
      file.write(JSON.stringify({ app: 'Shotloom Preview', version: '0.9.6', platform: 'react-native', locale: language, modelCount: catalog.publications.length, createdAt: new Date().toISOString() }, null, 2));
      await shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: t('settings.diagnostics.action') });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(false); }
  };
  const selectedType = models.find(([key]) => key === picker)?.[1];
  const available = catalog.publications.filter(model => model.published && model.available);
  const choices = available.filter(model => model.type === selectedType && `${model.name} ${model.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh(true)} />}>
      <View style={styles.field}><Text style={styles.heading}>{local('偏好设置', 'Preferences')}</Text><Text style={styles.secondary}>{t('settings.cloudGeneralDescription')}</Text></View>
      {error ? <View accessibilityRole="alert" style={styles.notice}><Text style={styles.error}>{error}</Text><Button title={t('support.refresh')} ghost onPress={() => void refresh(true)} /></View> : null}
      <View style={styles.recordCard}><View style={styles.inline}><Icon name="settings" color={colors.accent} /><Text style={styles.title}>{local('通用', 'General')}</Text></View><Text style={styles.body}>{t('settings.language')}</Text>
        <View style={styles.inline}>{(['zh-CN', 'en-US'] as const).map(locale => <Pressable key={locale} accessibilityRole="radio" accessibilityState={{ checked: (settings.locale || language) === locale, disabled: busy || !loaded }} disabled={busy || !loaded} onPress={() => void save({ locale })} style={[styles.selectAll, { flex: 1, backgroundColor: (settings.locale || language) === locale ? colors.wash : '#f5f5f5' }]}><Text style={styles.body}>{locale === 'zh-CN' ? '简体中文' : 'English'}</Text>{(settings.locale || language) === locale && <Icon name="check" color={colors.accent} size={16} />}</Pressable>)}</View>
        <Text style={styles.small}>{local('语言与账号同步，画布和其他页面返回后生效。', 'Language syncs with your account and applies when returning to other pages.')}</Text>
      </View>
      <View style={styles.recordCard}><View style={styles.inline}><Icon name="spark" color={colors.accent} /><Text style={styles.title}>Agent</Text>{busy && <ActivityIndicator color={colors.accent} />}</View>
        {toggles.map(([key, label, hint]) => <View key={key} style={styles.between}><View style={styles.grow}><Text style={styles.body}>{t(label)}</Text><Text style={styles.small}>{t(hint)}</Text></View><Switch accessibilityLabel={t(label)} value={settings[key] ?? (key === 'agentCanRunNodes' ? false : defaults.appSettings[key])} disabled={busy || !loaded} trackColor={{ true: colors.accent }} onValueChange={value => void save({ [key]: value })} /></View>)}
      </View>
      <View style={styles.recordCard}><Text style={styles.title}>{t('ui.SettingsPanel.text.b5bff31c')}</Text>
        {models.map(([key, , label]) => <Pressable key={key} accessibilityRole="button" disabled={busy || !loaded || Boolean(modelError)} onPress={() => { setQuery(''); setPicker(key); }} style={styles.between}><View style={styles.grow}><Text style={styles.body}>{t(label)}</Text><Text style={styles.small}>{available.find(model => model.id === settings[key])?.name || settings[key] || local('跟随默认配置', 'Use default')}</Text></View><Icon name="chevron-right" color={colors.muted} /></Pressable>)}
        {modelError && <View accessibilityRole="alert"><Text style={styles.error}>{modelError}</Text><Button title={t('support.refresh')} ghost onPress={() => void refresh(true)} /></View>}
      </View>
      <View style={styles.recordCard}><Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.between} onPress={() => setExpanded(value => !value)}><View style={styles.grow}><Text style={styles.title}>{t('settings.availableModels')}</Text><Text style={styles.small}>{local(`${available.length} 个模型，由服务端管理`, `${available.length} models, managed by the server`)}</Text></View><Icon name={expanded ? 'chevron-down' : 'chevron-right'} /></Pressable>{expanded && available.map(model => <View key={model.id} style={styles.field}><Text style={styles.body}>{model.name || model.id}</Text><Text style={styles.small}>{model.id} · {model.owned_by}</Text></View>)}</View>
      <View style={styles.recordCard}><Text style={styles.title}>{t('settings.diagnostics.title')}</Text><Text style={styles.small}>{local('导出应用版本、语言和模型数量，供排查问题使用。', 'Share app version, language and model count for troubleshooting.')}</Text><Button title={t('settings.diagnostics.action')} ghost disabled={busy} onPress={() => void diagnostics()} /></View>
    </ScrollView>
    <Modal visible={Boolean(picker)} animationType="slide" onRequestClose={() => { if (!busy) setPicker(undefined); }}><SafeAreaView style={styles.screen}><View style={styles.list}><View style={styles.between}><Text style={styles.title}>{local('选择模型', 'Choose model')}</Text><Button title={local('关闭', 'Close')} ghost disabled={busy} onPress={() => setPicker(undefined)} /></View><TextInput accessibilityLabel={local('搜索模型', 'Search models')} placeholder={local('搜索模型', 'Search models')} value={query} onChangeText={setQuery} style={styles.input} />{error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}<FlatList data={choices} keyExtractor={model => model.id} ListHeaderComponent={<Button title={local('跟随默认配置', 'Use default')} ghost disabled={busy} onPress={() => picker && void save({ [picker]: '' })} />} ListEmptyComponent={<Text style={styles.secondary}>{local('暂无匹配的可用模型', 'No matching models available')}</Text>} renderItem={({ item }) => <Pressable accessibilityRole="radio" accessibilityState={{ checked: picker ? settings[picker] === item.id : false }} disabled={busy} style={styles.accountAction} onPress={() => picker && void save({ [picker]: item.id })}><View style={styles.grow}><Text style={styles.body}>{item.name || item.id}</Text><Text style={styles.small}>{item.id}</Text></View>{picker && settings[picker] === item.id && <Icon name="check" color={colors.accent} />}</Pressable>} /></View></SafeAreaView></Modal>
  </SafeAreaView>;
}
