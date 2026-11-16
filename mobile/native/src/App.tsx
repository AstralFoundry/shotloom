import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { randomUUID } from 'expo-crypto';
import { getLocales } from 'expo-localization';
import { NativeApi } from './api';
import { isSessionSource } from './sessionSource';
import { SvgXml } from 'react-native-svg';
import { colors, styles, Icon, IconButton, Button as Action } from './ui';
import { noProjectIllustration } from './illustration';
import type { IconName } from '../../../shared/iconPaths';
import type { Feedback, FeedbackDetail, FeedbackKind, InboxPage, Page } from '../../../shared/support';
import zh from '../../../renderer/src/i18n/locales/zh-CN.json';
import en from '../../../renderer/src/i18n/locales/en-US.json';

let language = getLocales()[0]?.languageCode === 'zh' ? 'zh-CN' : 'en-US';
const t = (key: keyof typeof zh) => (language === 'zh-CN' ? zh : en)[key];
const local = (cn: string, english: string) => language === 'zh-CN' ? cn : english;
const origin = (process.env.EXPO_PUBLIC_CLOUD_URL || 'https://shotloom.0xfiang.com').replace(/\/$/, '');
const parsedOrigin = new URL(origin);
if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !(__DEV__ && parsedOrigin.protocol === 'http:'))) throw new Error('EXPO_PUBLIC_CLOUD_URL must be an HTTPS origin');
type Routes = { Home: undefined; Records: undefined; Compose: undefined; Feedback: { id: string }; Notifications: undefined; Workspace: { id: string; name: string; page?: 'projects' | 'skills' | 'account'; panel?: 'settings' | 'topup'; folder?: string } };
const Stack = createNativeStackNavigator<Routes>();
const ApiContext = createContext<NativeApi | null>(null);
function useApi() { const value = useContext(ApiContext); if (!value) throw new Error('Session unavailable'); return value; }
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
const date = (value: string) => new Date(value).toLocaleString(language);

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
type Project = { id: string; name: string; cloudFolderId?: string | null; updatedAt?: string; nodeCount?: number };
type Folder = { id: string; parentId: string | null; name: string };
type Account = { username?: string; email?: string; app_quota: number; app_used_quota: number };
type Usage = { total: number; page_size: number; items: { id: number; model_name: string; quota: number; created_at: number }[] };
const LogoutContext = createContext<() => void>(() => {});
const credits = (quota: number) => (quota / 10000).toLocaleString(language, { maximumFractionDigits: 4 });
function EmptyState({ title, description, artwork = false }: { title: string; description?: string; artwork?: boolean }) {
  return <View style={styles.empty}>{artwork ? <SvgXml xml={noProjectIllustration} width={134} height={134} /> : <Icon name="box" size={40} color="#bfbfbf" />}<Text style={styles.title}>{title}</Text>{description ? <Text style={[styles.secondary, { textAlign: 'center' }]}>{description}</Text> : null}</View>;
}
function Projects({ navigation, onOpen }: { navigation: NativeStackScreenProps<Routes, 'Home'>['navigation']; onOpen: (project: Project) => void }) {
  const api = useApi();
  const projects = useRemote<Project[]>('/projects');
  const folders = useRemote<Folder[]>('/library-folders');
  const [parents, setParents] = useState<Folder[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'updated' | 'name'>('updated');
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const parent = parents.at(-1);
  const refresh = () => { projects.refresh(); folders.refresh(); };
  const manage = () => navigation.navigate('Workspace', { id: '', name: t('ui.ProjectScopeHeader.text.79b705bd'), page: 'projects', ...(parent ? { folder: `cloud/projects/folders/${parent.id}` } : {}) });
  const entries = [
    ...(folders.data || []).filter(folder => folder.parentId === (parent?.id || null)).map(folder => ({ ...folder, kind: 'folder' as const })),
    ...(projects.data || []).filter(project => (project.cloudFolderId || null) === (parent?.id || null)).map(project => ({ ...project, kind: 'project' as const })),
  ].filter(entry => entry.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name, language) : new Date('updatedAt' in b ? b.updatedAt || 0 : 0).getTime() - new Date('updatedAt' in a ? a.updatedAt || 0 : 0).getTime());
  const createFolder = async () => {
    if (!draft?.trim() || busy) return;
    setBusy(true); setFailure('');
    try { await api.request('/library-folders', 'POST', { name: draft.trim(), parentId: parent?.id || null }); setDraft(null); refresh(); }
    catch (cause) { setFailure(errorText(cause)); } finally { setBusy(false); }
  };
  return <View style={styles.screen}>
    <FlatList data={entries} keyExtractor={item => item.id} refreshing={projects.loading || folders.loading} onRefresh={refresh} contentContainerStyle={styles.projectList}
      ListHeaderComponent={<><View style={styles.projectHead}>
        {parent && <Pressable accessibilityRole="button" style={[styles.inline, { minHeight: 48 }]} onPress={() => { setParents(value => value.slice(0, -1)); setQuery(''); }}><Icon name="chevron-left" /><Text style={styles.secondary}>{t('ui.ProjectScopeHeader.text.79b705bd')}</Text></Pressable>}
        <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', color: '#292929' }}>{parent?.name || t('ui.ProjectScopeHeader.text.79b705bd')}</Text>
        {!parent && <Text style={{ fontSize: 13, lineHeight: 20, color: colors.muted }}>{t('ui.ProjectsView.text.f5b63ec3')}</Text>}
        <View style={styles.projectActions}>{parent && <Action title={t('ui.ProjectsView.text.afb7afc7')} icon="grid" onPress={manage} />}<Action title={t('ui.ProjectsView.text.95cf3cd4')} icon="folder" ghost={Boolean(parent)} onPress={() => setDraft('')} /><Action title={t('ui.CreationView.text.60e2bcad')} icon="upload" ghost onPress={manage} /></View>
      </View><View style={styles.libraryHead}>
        <View style={styles.inline}><Text style={{ fontSize: 12, lineHeight: 18, fontWeight: '500', color: '#292929' }}>{parent?.name || t('ui.ProjectsView.text.f095b12b')}</Text><Text style={styles.small}>{local(`${entries.length} 项`, `${entries.length} items`)}</Text></View>
        <View style={styles.inline}><View style={styles.search}><Icon name="search" size={16} color={colors.muted} /><TextInput accessibilityLabel={t('ui.ProjectSearch.text.b617f05c')} placeholder={t('ui.ProjectSearch.text.b617f05c')} placeholderTextColor="#808080" value={query} onChangeText={setQuery} style={styles.searchInput} /></View><Action ghost title={sort === 'updated' ? local('最近更新', 'Recent') : local('名称', 'Name')} onPress={() => setSort(value => value === 'updated' ? 'name' : 'updated')} /></View>
      </View>{(projects.error || folders.error) ? <ErrorNotice text={projects.error || folders.error} retry={refresh} /> : null}</>}
      ListEmptyComponent={!projects.loading && !folders.loading && !projects.error && !folders.error ? <EmptyState artwork title={t(query.trim() ? 'ui.ProjectsView.text.ede67948' : 'ui.ProjectsView.text.a3dba20f')} description={!query.trim() ? t('ui.ProjectsView.text.f4ca1241') : undefined} /> : null}
      renderItem={({ item }) => <View style={styles.projectCard}><Pressable accessibilityRole="button" style={[styles.inline, styles.grow]} onPress={() => { if (item.kind === 'folder') { setParents(value => [...value, item]); setQuery(''); } else onOpen(item); }}>
        <View style={styles.projectPreview}><Icon name={item.kind === 'folder' ? 'folder' : 'grid'} size={30} color={colors.accent} /></View><View style={styles.grow}><Text numberOfLines={2} style={styles.projectName}>{item.name}</Text><Text style={styles.small}>{item.kind === 'folder' ? local('文件夹', 'Folder') : local('画布', 'Canvas')}</Text>{'updatedAt' in item && item.updatedAt ? <Text style={styles.small}>{date(item.updatedAt)}</Text> : null}</View>
      </Pressable><IconButton name="more" label={local('管理项目', 'Manage project')} onPress={manage} /></View>} />
    <Modal visible={draft !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) setDraft(null); }}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 }}><View style={[styles.row, { gap: 20 }]}><Text style={styles.title}>{t('ui.ProjectsView.text.95cf3cd4')}</Text><TextInput autoFocus accessibilityLabel={local('文件夹名称', 'Folder name')} placeholder={local('文件夹名称', 'Folder name')} value={draft || ''} onChangeText={setDraft} maxLength={200} editable={!busy} style={styles.input} onSubmitEditing={() => void createFolder()} />{failure ? <ErrorNotice text={failure} /> : null}<View style={styles.inline}><View style={styles.grow}><Action ghost disabled={busy} title={local('取消', 'Cancel')} onPress={() => setDraft(null)} /></View><View style={styles.grow}><Action disabled={busy || !draft?.trim()} title={local('创建', 'Create')} onPress={() => void createFolder()} /></View></View></View></KeyboardAvoidingView></Modal>
  </View>;
}
function Account({ navigation }: { navigation: NativeStackScreenProps<Routes, 'Home'>['navigation'] }) {
  const logout = useContext(LogoutContext);
  const account = useRemote<Account>('/auth/account');
  const me = useRemote<{ username?: string; email?: string }>('/auth/me');
  const [page, setPage] = useState(1);
  const usage = useRemote<Usage>(`/auth/usage?page=${page}&page_size=10`);
  const refresh = () => { account.refresh(); usage.refresh(); me.refresh(); };
  const openPanel = (panel: 'settings' | 'topup') => navigation.navigate('Workspace', { id: '', name: t(panel === 'settings' ? 'account.settings' : 'account.topup'), page: 'account', panel });
  const action = (icon: IconName, title: string, description: string, onPress: () => void) => <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.accountAction, pressed && styles.pressed]}><View style={styles.actionIcon}><Icon name={icon} /></View><View style={styles.grow}><Text style={styles.title}>{title}</Text><Text style={styles.actionDescription}>{description}</Text></View><Icon name="chevron-right" /></Pressable>;
  return <ScrollView contentContainerStyle={styles.account} refreshControl={<RefreshControl refreshing={account.loading} onRefresh={refresh} />}>
    <View style={styles.accountHeader}><Text style={styles.heading}>{t('account.title')}</Text><Text style={styles.secondary}>{t('account.description')}</Text></View>
    <View style={styles.profile}><View style={styles.avatar}><Icon name="user" size={26} color={colors.accent} /></View><View style={styles.grow}><Text style={styles.profileName}>{account.data?.username || me.data?.username || t('account.welcome')}</Text><Text style={styles.secondary}>{account.data?.email || me.data?.email || 'new-api'}</Text></View></View>
    <View style={styles.wallet}><View style={styles.between}><Text style={[styles.body, styles.white]}>{t('account.quota')}</Text><IconButton name="refresh" light label={t('account.refresh')} disabled={account.loading} onPress={refresh} /></View><Text style={styles.quota}>{account.data ? credits(account.data.app_quota) : '—'}</Text><View style={[styles.inline, { gap: 16 }]}><Text style={styles.used}>{t('account.used')}</Text><Text style={styles.used}>{account.data ? credits(account.data.app_used_quota) : '—'}</Text></View><View style={styles.walletBottom}><Text style={styles.walletNote}>{t('account.quotaDescription')}</Text><Action title={t('account.topup')} icon="plus" ghost onPress={() => openPanel('topup')} /></View>{account.error ? <Text accessibilityRole="alert" style={[styles.walletNote, { marginTop: 12 }]}>{t('account.loadFailed')}</Text> : null}</View>
    <View style={styles.accountActions}>{action('settings', t('account.settings'), t('settings.cloudGeneralDescription'), () => openPanel('settings'))}{action('scan-text', t('support.title'), t('support.accountDescription'), () => navigation.navigate('Compose'))}</View>
    <View style={styles.usage}><View style={styles.between}><View style={styles.grow}><Text style={styles.title}>{t('account.usage')}</Text><Text style={[styles.small, { marginTop: 8 }]}>{t('account.usageScope')}</Text></View><IconButton name="refresh" label={t('account.refreshUsage')} disabled={usage.loading} onPress={usage.refresh} /></View>
      {usage.loading ? <ActivityIndicator color={colors.accent} /> : usage.error ? <><Text style={styles.error}>{t('account.usageFailed')}</Text><Action ghost title={t('account.retryUsage')} onPress={usage.refresh} /></> : !usage.data?.items.length ? <Text style={styles.secondary}>{t('account.usageEmpty')}</Text> : usage.data.items.map(item => <View key={item.id} style={styles.usageItem}><View style={styles.between}><Text style={[styles.body, styles.grow]}>{item.model_name || t('account.usageUnknownModel')}</Text><Text style={styles.body}>{credits(item.quota)} {local('积分', 'credits')}</Text></View><Text style={styles.small}>{date(new Date(item.created_at * 1000).toISOString())}</Text></View>)}
      <View style={styles.between}><Action title={t('account.previousPage')} ghost disabled={usage.loading || page === 1} onPress={() => setPage(value => value - 1)} /><Text style={styles.small}>{page} / {Math.max(1, Math.ceil((usage.data?.total || 0) / 10))}</Text><Action title={t('account.nextPage')} ghost disabled={usage.loading || !usage.data || page * 10 >= usage.data.total || page >= 10000} onPress={() => setPage(value => value + 1)} /></View>
    </View><View style={styles.accountFooter}><Action title={t('cloud.logout')} ghost onPress={logout} /></View>
  </ScrollView>;
}
function Home({ navigation }: NativeStackScreenProps<Routes, 'Home'>) {
  const [tab, setTab] = useState<'projects' | 'skills' | 'account'>('projects');
  const [currentProject, setCurrentProject] = useState<Project>();
  const inbox = useRemote<InboxPage>('/notifications?offset=0&limit=1');
  const open = (project: Project) => { setCurrentProject(project); navigation.navigate('Workspace', project); };
  const tabs: Array<{ id: 'projects' | 'creation' | 'skills' | 'account'; label: string; icon: IconName }> = [
    { id: 'projects', label: t('ui.ProjectScopeHeader.text.79b705bd'), icon: 'folder' },
    { id: 'creation', label: t('ui.navigation.label.a1fce3b0'), icon: 'grid' },
    { id: 'skills', label: t('ui.navigation.label.53da139b'), icon: 'puzzle' },
    { id: 'account', label: t('account.title'), icon: 'user' },
  ];
  return <SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content" backgroundColor={colors.background} /><View style={styles.grow}>
    {tab === 'projects' ? <Projects navigation={navigation} onOpen={open} /> : tab === 'account' ? <Account navigation={navigation} /> : <WebContent params={{ id: '', name: '', page: 'skills' }} embedded />}
    <View style={styles.bell}><IconButton name="bell" label={t('support.notifications')} onPress={() => navigation.navigate('Notifications')} />{inbox.data?.unread ? <View pointerEvents="none" style={styles.badge}><Text style={styles.badgeText}>{inbox.data.unread > 99 ? '99+' : inbox.data.unread}</Text></View> : null}</View>
  </View><View accessibilityRole="tablist" style={styles.tabs}>{tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id, disabled: item.id === 'creation' && !currentProject }} disabled={item.id === 'creation' && !currentProject} onPress={() => { if (item.id === 'creation') { if (currentProject) open(currentProject); } else setTab(item.id); }} style={({ pressed }) => [styles.tab, tab === item.id && styles.tabActive, item.id === 'creation' && !currentProject && styles.disabled, pressed && styles.pressed]}><Icon name={item.icon} color={tab === item.id ? colors.accent : colors.muted} /><Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text></Pressable>)}</View></SafeAreaView>;
}
function SupportTabs({ active, navigation }: { active: 'Compose' | 'Records' | 'Notifications'; navigation: Pick<NativeStackScreenProps<Routes, 'Home'>['navigation'], 'navigate'> }) {
  const tabs = [{ route: 'Compose' as const, label: t('support.submit') }, { route: 'Records' as const, label: t('support.history') }, { route: 'Notifications' as const, label: t('support.notifications') }];
  return <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 28, borderBottomWidth: 1, borderColor: colors.line }} accessibilityRole="tablist">{tabs.map(tab => <Pressable key={tab.route} accessibilityRole="tab" accessibilityState={{ selected: active === tab.route }} style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 2, borderColor: active === tab.route ? colors.accent : 'transparent' }} onPress={() => { if (active !== tab.route) navigation.navigate(tab.route); }}><Text style={{ fontSize: 13, lineHeight: 20, color: active === tab.route ? colors.accent : colors.text }}>{tab.label}</Text></Pressable>)}</ScrollView></View>;
}
function Records({ navigation }: NativeStackScreenProps<Routes, 'Records'>) {
  const [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useRemote<Page<Feedback>>(`/feedback?offset=${page * 20}&limit=20`);
  return <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: colors.surface }]}><SupportTabs active="Records" navigation={navigation} />
    {error && <ErrorNotice text={error} retry={refresh} />}
    <FlatList data={data?.items || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <EmptyState title={t('support.empty')} /> : null}
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
  const [kindOpen, setKindOpen] = useState(false);
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
  return <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: colors.surface }]}><SupportTabs active="Compose" navigation={navigation} /><KeyboardAvoidingView style={[styles.screen, { backgroundColor: colors.surface }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={96}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
      {error && <ErrorNotice text={error} />}
      <Text style={styles.body}>{t('support.kind')}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('support.kind')} accessibilityState={{ expanded: kindOpen }} disabled={busy} onPress={() => setKindOpen(true)} style={[styles.input, styles.between]}><Text style={styles.body}>{t(`support.${kind}`)}</Text><Icon name="chevron-down" size={16} color="#bfbfbf" /></Pressable>
      <Text style={styles.body}><Text style={{ color: '#c8443c' }}>* </Text>{t('support.description')}</Text><TextInput accessibilityLabel={t('support.description')} value={description} onChangeText={setDescription} editable={!busy} multiline maxLength={10000} style={[styles.input, styles.description]} textAlignVertical="top" />
      <Text style={styles.body}>{t('support.reference')}</Text><TextInput accessibilityLabel={t('support.reference')} value={reference} onChangeText={setReference} editable={!busy} maxLength={1000} style={styles.input} />
      <Text style={styles.secondary}>{t('support.referenceHelp')}</Text>
      <View style={{ alignSelf: 'flex-start', marginTop: 4 }}><Action accent title={busy ? local('提交中…', 'Submitting…') : t('support.submit')} disabled={busy || !description.trim()} onPress={() => void submit()} /></View>
    </ScrollView>
  </KeyboardAvoidingView><Modal visible={kindOpen} transparent animationType="fade" onRequestClose={() => setKindOpen(false)}><Pressable accessibilityRole="button" accessibilityLabel={local('关闭类型选择', 'Close type selection')} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', padding: 24, justifyContent: 'center' }} onPress={() => setKindOpen(false)}><View style={styles.row}>{(['feedback', 'report'] as const).map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: value === kind }} style={[styles.choice, { flex: 0 }, value === kind && styles.chosen]} onPress={() => { setKind(value); setKindOpen(false); }}><Text style={styles.body}>{t(`support.${value}`)}</Text></Pressable>)}</View></Pressable></Modal></SafeAreaView>;
}
function Notifications({ navigation }: NativeStackScreenProps<Routes, 'Notifications'>) {
  const api = useApi();
  const [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useRemote<InboxPage>(`/notifications?offset=${page * 20}&limit=20`);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setFailure(''); try { await operation(); refresh(); } catch (cause) { setFailure(errorText(cause)); } finally { setBusy(false); } };
  return <SafeAreaView edges={['bottom']} style={[styles.screen, { backgroundColor: colors.surface }]}><SupportTabs active="Notifications" navigation={navigation} />
    {(error || failure) ? <ErrorNotice text={error || failure} retry={refresh} /> : null}
    <View style={styles.actions}><Text style={styles.title}>{local('未读', 'Unread')}: {data?.unread || 0}</Text><Action title={t('support.readAll')} disabled={busy || !data?.unread} onPress={() => void run(async () => { await api.request('/notifications/read-all', 'PUT', { asOf: data!.asOf }); })} /></View>
    <FlatList data={data?.items || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.list}
      ListEmptyComponent={!loading && !error ? <EmptyState title={t('support.noNotifications')} /> : null}
      renderItem={({ item }) => <View style={styles.row}><Pressable accessibilityRole="button" disabled={busy} onPress={() => void run(async () => { await api.request(`/notifications/${item.id}/read`, 'PUT'); navigation.navigate('Feedback', { id: item.feedback_id }); })}>
        <Text style={styles.title}>{!item.read_at ? '● ' : ''}{t('support.replyReceived')}</Text><Text numberOfLines={3} style={styles.body}>{item.body}</Text><Text style={styles.secondary}>{date(item.created_at)}</Text>
      </Pressable>{!item.read_at && <Action title={t('support.read')} disabled={busy} onPress={() => void run(async () => { await api.request(`/notifications/${item.id}/read`, 'PUT'); })} />}</View>} />
    <View style={styles.actions}><Action title={local('上一页', 'Previous')} disabled={!page} onPress={() => setPage(value => value - 1)} /><Action title={local('下一页', 'Next')} disabled={(page + 1) * 20 >= (data?.total || 0)} onPress={() => setPage(value => value + 1)} /></View>
  </SafeAreaView>;
}
function WebContent({ params, embedded = false }: { params: Routes['Workspace']; embedded?: boolean }) {
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams();
  if (params.id) { query.set('project', params.id); query.set('route', 'creation'); }
  else if (params.page) query.set('route', params.page);
  if (params.panel) query.set('panel', params.panel);
  if (params.folder) query.set('folder', params.folder);
  // Workspace content has no native bridge. Embedded skill content uses the native tab bar.
  const injected = `window.__SHOTLOOM_MOBILE__ = true; ${embedded ? `document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.textContent='.app-shell .sidebar-shell,.app-shell .topbar,.support-launcher{display:none!important}.app-shell .workspace{grid-template-rows:minmax(0,1fr)!important}';document.head.appendChild(s)});` : ''} true;`;
  return <View style={styles.screen}>{error && <ErrorNotice text={error} retry={() => { setError(''); setRetry(value => value + 1); }} />}
    <WebView key={retry} source={{ uri: `${origin}/?${query}` }} style={styles.screen} sharedCookiesEnabled thirdPartyCookiesEnabled={false}
      mixedContentMode="never" setSupportMultipleWindows={false} injectedJavaScriptBeforeContentLoaded={injected} onError={event => setError(event.nativeEvent.description)} onHttpError={event => setError(`HTTP ${event.nativeEvent.statusCode}`)} />
  </View>;
}
function Workspace({ route }: NativeStackScreenProps<Routes, 'Workspace'>) {
  return <SafeAreaView edges={route.params.id ? ['top', 'bottom'] : ['bottom']} style={styles.screen}><WebContent params={route.params} /></SafeAreaView>;
}
export default function App() {
  const webview = useRef<WebView>(null);
  const sessionDocument = useRef(`${origin}/native`);
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
  return <SafeAreaProvider><View style={styles.screen}><ApiContext.Provider value={api}><LogoutContext.Provider value={() => void logout()}>
    {opened && <NavigationContainer linking={{ prefixes: ['shotloom-preview://'], config: { screens: { Feedback: 'feedback/:id', Notifications: 'notifications' } } }}>
      <Stack.Navigator screenOptions={{ headerBackButtonDisplayMode: 'minimal', contentStyle: styles.screen, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerTitleStyle: { fontSize: 16, fontWeight: '500' } }}>
        <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
        <Stack.Screen name="Compose" component={Compose} options={{ title: t('support.title'), headerStyle: { backgroundColor: colors.surface } }} />
        <Stack.Screen name="Records" component={Records} options={{ title: t('support.history') }} />
        <Stack.Screen name="Feedback" component={Thread} options={{ title: t('support.title') }} />
        <Stack.Screen name="Notifications" component={Notifications} options={{ title: t('support.notifications') }} />
        <Stack.Screen name="Workspace" component={Workspace} options={({ route }) => ({ title: route.params.name, headerShown: !route.params.id })} />
      </Stack.Navigator>
    </NavigationContainer>}
    <View style={authenticated ? styles.hiddenBridge : styles.loginBridge} pointerEvents={authenticated ? 'none' : 'auto'}>
      <SafeAreaView style={styles.screen}>
        {failure && <ErrorNotice text={failure} retry={() => { setFailure(''); webview.current?.reload(); }} />}
        <WebView ref={webview} source={{ uri: `${origin}/native` }} sharedCookiesEnabled thirdPartyCookiesEnabled={false} mixedContentMode="never" setSupportMultipleWindows={false}
          onLoadStart={event => { sessionDocument.current = event.nativeEvent.url; api.disconnect(); setAuthenticated(false); }} onError={event => { setFailure(event.nativeEvent.description); setAuthenticated(false); }}
          onHttpError={event => { setFailure(`HTTP ${event.nativeEvent.statusCode}`); setAuthenticated(false); }}
          onMessage={event => {
            // OAuth provider pages and workspace content never get native bridge privileges.
            if (!isSessionSource(event.nativeEvent.url, sessionDocument.current, origin)) return;
            try {
              const value = JSON.parse(event.nativeEvent.data);
              if (value.type === 'ready' && typeof value.userId === 'string') {
                if (user.current && user.current !== value.userId) { setFailure(t('cloud.login.accountChanged')); setAuthenticated(false); return; }
                if (value.locale === 'zh-CN' || value.locale === 'en-US') language = value.locale;
                user.current = value.userId; setOpened(true); setAuthenticated(true); setFailure('');
              } else if (value.type === 'login') { setAuthenticated(false); api.disconnect(); }
              else if (value.type === 'response' && typeof value.id === 'string') api.receive(value);
            } catch { setFailure(local('会话响应无效，请重试。', 'Invalid session response. Please retry.')); }
          }} />
      </SafeAreaView>
    </View>
  </LogoutContext.Provider></ApiContext.Provider></View></SafeAreaProvider>;
}
