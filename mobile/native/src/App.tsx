import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { NativeApi } from './api';
import type { Feedback, FeedbackDetail, FeedbackKind, InboxPage, Page } from '../../../shared/support';
import zh from '../../../renderer/src/i18n/locales/zh-CN.json';
import en from '../../../renderer/src/i18n/locales/en-US.json';

const language = getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en-US';
const catalog = language === 'zh-CN' ? zh : en;
const t = (key: keyof typeof zh) => catalog[key];
const local = (cn: string, english: string) => language === 'zh-CN' ? cn : english;
const origin = (process.env.EXPO_PUBLIC_CLOUD_URL || 'https://shotloom.0xfiang.com').replace(/\/$/, '');
const parsedOrigin = new URL(origin);
if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !(__DEV__ && parsedOrigin.protocol === 'http:'))) throw new Error('EXPO_PUBLIC_CLOUD_URL must be an HTTPS origin');
type Routes = { Home: undefined; Records: undefined; Compose: undefined; Feedback: { id: string }; Notifications: undefined; Workspace: { id: string; name: string } };
const Stack = createNativeStackNavigator<Routes>();
const ApiContext = createContext<NativeApi | null>(null);
function useApi() { const value = useContext(ApiContext); if (!value) throw new Error('Session unavailable'); return value; }
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
const date = (value: string) => new Date(value).toLocaleString(language);

function Action({ title, onPress, disabled = false }: { title: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, pressed && styles.pressed, disabled && styles.disabled]}><Text style={styles.buttonText}>{title}</Text></Pressable>;
}
function ErrorNotice({ text, retry }: { text: string; retry?: () => void }) {
  return <View accessibilityRole="alert" style={styles.notice}><Text style={styles.error}>{text}</Text>{retry && <Action title={t('support.refresh')} onPress={retry} />}</View>;
}
function useRemote<T>(path: string) {
  const api = useApi();
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setError('');
    void api.request<T>(path).then(value => { if (active) setData(value); }).catch(cause => { if (active) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { active = false; subscription.remove(); };
  }, [api, path, revision, refresh]));
  return { data, error, loading, refresh };
}
function Home({ navigation }: NativeStackScreenProps<Routes, 'Home'>) {
  const { data, error, loading, refresh } = useRemote<Array<{ id: string; name: string }>>('/projects');
  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    <View style={styles.actions}><Action title={t('support.submit')} onPress={() => navigation.navigate('Compose')} /><Action title={t('support.history')} onPress={() => navigation.navigate('Records')} /><Action title={t('support.notifications')} onPress={() => navigation.navigate('Notifications')} /></View>
    {error && <ErrorNotice text={error} retry={refresh} />}
    <FlatList data={data || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <Text>{local('暂无工程，可在工作区创建。', 'No projects yet. Create one in the workspace.')}</Text> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.row} onPress={() => navigation.navigate('Workspace', item)}><Text style={styles.title}>{item.name}</Text><Text style={styles.secondary}>{local('打开工作区', 'Open workspace')}</Text></Pressable>} />
    <Action title={local('打开工作区', 'Open workspace')} onPress={() => navigation.navigate('Workspace', { id: '', name: 'Shotloom' })} />
  </SafeAreaView>;
}
function Records({ navigation }: NativeStackScreenProps<Routes, 'Records'>) {
  const [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useRemote<Page<Feedback>>(`/feedback?offset=${page * 20}&limit=20`);
  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    {error && <ErrorNotice text={error} retry={refresh} />}
    <FlatList data={data?.items || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <Text>{t('support.empty')}</Text> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" style={styles.row} onPress={() => navigation.navigate('Feedback', { id: item.id })}>
        <Text style={styles.secondary}>{t(`support.${item.kind}`)} · {t(`support.${item.status}`)}</Text><Text numberOfLines={3} style={styles.body}>{item.description}</Text><Text style={styles.secondary}>{date(item.created_at)}</Text>
      </Pressable>} />
    <View style={styles.actions}><Action title={local('上一页', 'Previous')} disabled={!page} onPress={() => setPage(value => value - 1)} /><Action title={local('下一页', 'Next')} disabled={(page + 1) * 20 >= (data?.total || 0)} onPress={() => setPage(value => value + 1)} /></View>
  </SafeAreaView>;
}
function Thread({ route }: NativeStackScreenProps<Routes, 'Feedback'>) {
  const { data, error, loading, refresh } = useRemote<FeedbackDetail>(`/feedback/${route.params.id}`);
  return <SafeAreaView edges={['bottom']} style={styles.screen}><ScrollView contentContainerStyle={styles.list}>
    {loading && <ActivityIndicator />}{error && <ErrorNotice text={error} retry={refresh} />}
    {data && <><Text selectable style={styles.secondary}>{data.item.id}</Text><Text style={styles.title}>{t(`support.${data.item.kind}`)} · {t(`support.${data.item.status}`)}</Text><Text selectable style={styles.body}>{data.item.description}</Text>
      {data.item.reference ? <Text selectable style={styles.body}>{data.item.reference}</Text> : null}
      <Text style={styles.title}>{t('support.replies')}</Text>
      {!data.replies.length && <Text>{t('support.noReplies')}</Text>}
      {data.replies.map(reply => <View key={reply.id} style={styles.row}><Text style={styles.secondary}>{date(reply.created_at)}</Text><Text selectable style={styles.body}>{reply.body}</Text></View>)}
    </>}
    <Action title={t('support.refresh')} onPress={refresh} />
  </ScrollView></SafeAreaView>;
}
function Compose({ navigation }: NativeStackScreenProps<Routes, 'Compose'>) {
  const api = useApi();
  const [kind, setKind] = useState<FeedbackKind>('feedback');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef<{ payload: string; id: string } | undefined>(undefined);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const value = { kind, description: description.trim(), reference: reference.trim() };
      const payload = JSON.stringify(value);
      if (attempt.current?.payload !== payload) attempt.current = { payload, id: randomUUID() };
      const saved = await api.request<Feedback>('/feedback', 'POST', { ...value, id: attempt.current.id });
      navigation.replace('Feedback', { id: saved.id });
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  };
  return <SafeAreaView edges={['bottom']} style={styles.screen}><KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={96}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
      {error && <ErrorNotice text={error} />}
      <Text style={styles.title}>{t('support.kind')}</Text>
      <View accessibilityRole="radiogroup" style={styles.actions}>{(['feedback', 'report'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: kind === value }} disabled={busy} style={[styles.choice, kind === value && styles.chosen]} onPress={() => setKind(value)}><Text>{t(`support.${value}`)}</Text></Pressable>)}</View>
      <Text style={styles.title}>{t('support.description')}</Text><TextInput accessibilityLabel={t('support.description')} value={description} onChangeText={setDescription} editable={!busy} multiline maxLength={10000} style={[styles.input, styles.description]} textAlignVertical="top" />
      <Text style={styles.title}>{t('support.reference')}</Text><TextInput accessibilityLabel={t('support.reference')} value={reference} onChangeText={setReference} editable={!busy} maxLength={1000} style={styles.input} />
      <Text style={styles.secondary}>{t('support.referenceHelp')}</Text>
      <Action title={busy ? local('提交中…', 'Submitting…') : t('support.submit')} disabled={busy || !description.trim()} onPress={() => void submit()} />
    </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>;
}
function Notifications({ navigation }: NativeStackScreenProps<Routes, 'Notifications'>) {
  const api = useApi();
  const [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useRemote<InboxPage>(`/notifications?offset=${page * 20}&limit=20`);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setFailure(''); try { await operation(); refresh(); } catch (cause) { setFailure(errorText(cause)); } finally { setBusy(false); } };
  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    {(error || failure) ? <ErrorNotice text={error || failure} retry={refresh} /> : null}
    <View style={styles.actions}><Text style={styles.title}>{local('未读', 'Unread')}: {data?.unread || 0}</Text><Action title={t('support.readAll')} disabled={busy || !data?.unread} onPress={() => void run(async () => { await api.request('/notifications/read-all', 'PUT', { asOf: data!.asOf }); })} /></View>
    <FlatList data={data?.items || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <Text>{t('support.noNotifications')}</Text> : null}
      renderItem={({ item }) => <View style={styles.row}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(async () => { await api.request(`/notifications/${item.id}/read`, 'PUT'); navigation.navigate('Feedback', { id: item.feedback_id }); })}>
        <Text style={styles.title}>{!item.read_at ? '● ' : ''}{t('support.replyReceived')}</Text><Text numberOfLines={3} style={styles.body}>{item.body}</Text><Text style={styles.secondary}>{date(item.created_at)}</Text>
      </Pressable>{!item.read_at && <Action title={t('support.read')} disabled={busy} onPress={() => void run(async () => { await api.request(`/notifications/${item.id}/read`, 'PUT'); })} />}</View>} />
    <View style={styles.actions}><Action title={local('上一页', 'Previous')} disabled={!page} onPress={() => setPage(value => value - 1)} /><Action title={local('下一页', 'Next')} disabled={(page + 1) * 20 >= (data?.total || 0)} onPress={() => setPage(value => value + 1)} /></View>
  </SafeAreaView>;
}
function Workspace({ route }: NativeStackScreenProps<Routes, 'Workspace'>) {
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  return <SafeAreaView edges={['bottom']} style={styles.screen}>{error && <ErrorNotice text={error} retry={() => { setError(''); setRetry(value => value + 1); }} />}
    <WebView key={retry} source={{ uri: `${origin}/${route.params.id ? `?project=${encodeURIComponent(route.params.id)}` : ''}` }} sharedCookiesEnabled thirdPartyCookiesEnabled={false}
      mixedContentMode="never" setSupportMultipleWindows={false} injectedJavaScriptBeforeContentLoaded="window.__SHOTLOOM_MOBILE__ = true; true;" onError={event => setError(event.nativeEvent.description)} onHttpError={event => setError(`HTTP ${event.nativeEvent.statusCode}`)} />
  </SafeAreaView>;
}
export default function App() {
  const webview = useRef<WebView>(null);
  const user = useRef<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [failure, setFailure] = useState('');
  const api = useMemo(() => new NativeApi(request => {
    if (!webview.current) throw new Error('Session unavailable');
    webview.current.injectJavaScript(`window.__shotloomNativeRequest?.(${JSON.stringify(request)}); true;`);
  }, randomUUID), []);
  useEffect(() => () => api.disconnect(), [api]);
  const logout = async () => {
    try { await api.request('/auth/logout', 'POST'); user.current = null; setOpened(false); setAuthenticated(false); webview.current?.reload(); }
    catch (cause) { setFailure(errorText(cause)); }
  };
  return <SafeAreaProvider><View style={styles.screen}><ApiContext.Provider value={api}>
    {opened && <NavigationContainer linking={{ prefixes: ['shotloom-preview://'], config: { screens: { Feedback: 'feedback/:id', Notifications: 'notifications' } } }}>
      <Stack.Navigator screenOptions={{ headerBackButtonDisplayMode: 'minimal', contentStyle: styles.screen }}>
        <Stack.Screen name="Home" component={Home} options={{ title: 'Shotloom', headerRight: () => <Pressable accessibilityRole="button" onPress={() => void logout()}><Text>{t('cloud.logout')}</Text></Pressable> }} />
        <Stack.Screen name="Compose" component={Compose} options={{ title: t('support.submit') }} />
        <Stack.Screen name="Records" component={Records} options={{ title: t('support.history') }} />
        <Stack.Screen name="Feedback" component={Thread} options={{ title: t('support.title') }} />
        <Stack.Screen name="Notifications" component={Notifications} options={{ title: t('support.notifications') }} />
        <Stack.Screen name="Workspace" component={Workspace} options={({ route }) => ({ title: route.params.name })} />
      </Stack.Navigator>
    </NavigationContainer>}
    <View style={authenticated ? styles.hiddenBridge : styles.loginBridge} pointerEvents={authenticated ? 'none' : 'auto'}>
      <SafeAreaView style={styles.screen}>
        {failure && <ErrorNotice text={failure} retry={() => { setFailure(''); webview.current?.reload(); }} />}
        <WebView ref={webview} source={{ uri: `${origin}/native` }} sharedCookiesEnabled thirdPartyCookiesEnabled={false} mixedContentMode="never" setSupportMultipleWindows={false}
          onLoadStart={() => { api.disconnect(); setAuthenticated(false); }} onError={event => { setFailure(event.nativeEvent.description); setAuthenticated(false); }}
          onHttpError={event => { setFailure(`HTTP ${event.nativeEvent.statusCode}`); setAuthenticated(false); }}
          onMessage={event => {
            // OAuth provider pages and workspace content never get native bridge privileges.
            if (event.nativeEvent.url.split('?')[0] !== `${origin}/native`) return;
            try {
              const value = JSON.parse(event.nativeEvent.data);
              if (value.type === 'ready' && typeof value.userId === 'string') {
                if (user.current && user.current !== value.userId) { setFailure(t('cloud.login.accountChanged')); setAuthenticated(false); return; }
                user.current = value.userId; setOpened(true); setAuthenticated(true); setFailure('');
              } else if (value.type === 'login') { setAuthenticated(false); api.disconnect(); }
              else if (value.type === 'response' && typeof value.id === 'string') api.receive(value);
            } catch { setFailure(local('会话响应无效，请重试。', 'Invalid session response. Please retry.')); }
          }} />
      </SafeAreaView>
    </View>
  </ApiContext.Provider></View></SafeAreaProvider>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fafafa' },
  list: { padding: 20, gap: 16, flexGrow: 1 },
  actions: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  row: { padding: 16, gap: 10, backgroundColor: '#ffffff', borderRadius: 12, borderWidth: 1, borderColor: '#e6e6e6' },
  title: { fontSize: 17, fontWeight: '600', color: '#000000' },
  body: { fontSize: 16, lineHeight: 24, color: '#202020' },
  secondary: { fontSize: 13, color: '#606060', lineHeight: 20 },
  button: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, backgroundColor: '#202020', alignItems: 'center' },
  buttonText: { fontSize: 15, color: '#ffffff', fontWeight: '600' },
  pressed: { opacity: 0.75 }, disabled: { opacity: 0.4 },
  choice: { minHeight: 44, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: '#c0c0c0' },
  chosen: { borderColor: '#202020', backgroundColor: '#e6e6e6' },
  input: { minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#c0c0c0', fontSize: 16, backgroundColor: '#ffffff' },
  description: { minHeight: 180 }, notice: { padding: 16, gap: 8 }, error: { color: '#a12622', fontSize: 15 },
  hiddenBridge: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  loginBridge: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: '#ffffff' },
});
