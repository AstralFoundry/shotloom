import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StatusBar, Text, TextInput, View } from 'react-native';
import { NavigationContainer, useFocusEffect } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { randomUUID } from 'expo-crypto';
import { NativeApi, createNativeApi } from './api';
import { restoreSession, clearSession, login, workspaceSource, type NativeSession } from './session';
import { SvgXml } from 'react-native-svg';
import { colors, styles, Icon, IconButton, Button as Action } from './ui';
import { noProjectIllustration } from './illustration';
import type { IconName } from '../../../shared/iconPaths';
import type { Feedback, FeedbackDetail, FeedbackKind, InboxPage, Page } from '../../../shared/support';
import { language, local, setLanguage, t } from './i18n';
import { NativeSkills } from './NativeSkills';
import { NativeSettings } from './NativeSettings';
const origin = (process.env.EXPO_PUBLIC_CLOUD_URL || 'https://shotloom.0xfiang.com').replace(/\/$/, '');
const parsedOrigin = new URL(origin);
if (parsedOrigin.origin !== origin || (parsedOrigin.protocol !== 'https:' && !(__DEV__ && parsedOrigin.protocol === 'http:'))) throw new Error('EXPO_PUBLIC_CLOUD_URL must be an HTTPS origin');
type Routes = { Home: undefined; Settings: undefined; Records: undefined; Compose: undefined; Feedback: { id: string }; Notifications: undefined; Workspace: { id: string; name: string; page?: 'projects' | 'account'; panel?: 'settings' | 'topup'; folder?: string } };
const Stack = createNativeStackNavigator<Routes>();
const SettingsChanged = createContext({ revision: 0, changed: () => {} });
const PageActive = createContext(true);
const ApiContext = createContext<NativeApi | null>(null);
const SessionContext = createContext<(NativeSession & { expire: () => void }) | null>(null);
const WorkspaceCookieReady = createContext(false);
function useApi() { const value = useContext(ApiContext); if (!value) throw new Error('Session unavailable'); return value; }
const errorText = (value: unknown) => value instanceof Error ? value.message : String(value);
const date = (value: string) => new Date(value).toLocaleString(language);

function ErrorNotice({ text, retry }: { text: string; retry?: () => void }) {
  return <View accessibilityRole="alert" style={styles.notice}><Text style={styles.error}>{text}</Text>{retry && <Action title={t('support.refresh')} onPress={retry} />}</View>;
}
function useRemote<T>(path: string) {
  const api = useApi();
  const pageActive = useContext(PageActive);
  const force = useRef(false);
  const showRefresh = useRef(false);
  const dataVersion = useRef(0);
  const [data, setData] = useState<T | undefined>(() => api.cached<T>(path));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => api.cached(path) === undefined);
  const [revision, setRevision] = useState(0);
  const updateData = useCallback<typeof setData>(value => { dataVersion.current++; setData(value); }, []);
  const refresh = useCallback(() => { force.current = true; showRefresh.current = true; setRevision(value => value + 1); }, []);
  useFocusEffect(useCallback(() => {
    if (!pageActive) return;
    let active = true;
    const version = dataVersion.current;
    const bypass = force.current; force.current = false;
    const cached = api.cached<T>(path);
    setLoading(cached === undefined || showRefresh.current); showRefresh.current = false; setError('');
    if (cached !== undefined) setData(cached);
    const read = path === '/auth/me' && cached !== undefined && !bypass ? Promise.resolve(cached) : api.read<T>(path, bypass);
    void read.then(value => { if (active && version === dataVersion.current) setData(value); }).catch(cause => { if (active && version === dataVersion.current) setError(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && previousState !== 'active') { force.current = true; setRevision(value => value + 1); }
      previousState = state;
    });
    return () => { active = false; subscription.remove(); };
  }, [api, path, revision, refresh, pageActive]));
  return { data, error, loading, refresh, setData: updateData };
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
  const inbox = useRemote<InboxPage>('/notifications?offset=0&limit=1');
  const [page, setPage] = useState(1);
  const usage = useRemote<Usage>(`/auth/usage?page=${page}&page_size=10`);
  const refresh = () => { account.refresh(); usage.refresh(); me.refresh(); };
  const openPanel = (panel: 'settings' | 'topup') => panel === 'settings' ? navigation.navigate('Settings') : navigation.navigate('Workspace', { id: '', name: t('account.topup'), page: 'account', panel });
  const action = (icon: IconName, title: string, description: string, onPress: () => void) => <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.accountAction, pressed && styles.pressed]}><View style={styles.actionIcon}><Icon name={icon} /></View><View style={styles.grow}><Text style={styles.title}>{title}</Text><Text style={styles.actionDescription}>{description}</Text></View><Icon name="chevron-right" /></Pressable>;
  return <ScrollView contentContainerStyle={styles.account} refreshControl={<RefreshControl refreshing={account.loading} onRefresh={refresh} />}>
    <View style={styles.accountHeader}><Text style={styles.heading}>{t('account.title')}</Text><Text style={styles.secondary}>{t('account.description')}</Text></View>
    <View style={styles.profile}><View style={styles.avatar}><Icon name="user" size={26} color={colors.accent} /></View><View style={styles.grow}><Text style={styles.profileName}>{account.data?.username || me.data?.username || t('account.welcome')}</Text><Text style={styles.secondary}>{account.data?.email || me.data?.email || 'new-api'}</Text></View></View>
    <View style={styles.wallet}><View style={styles.between}><Text style={[styles.body, styles.white]}>{t('account.quota')}</Text><IconButton name="refresh" light label={t('account.refresh')} disabled={account.loading} onPress={refresh} /></View><Text style={styles.quota}>{account.data ? credits(account.data.app_quota) : '—'}</Text><View style={[styles.inline, { gap: 16 }]}><Text style={styles.used}>{t('account.used')}</Text><Text style={styles.used}>{account.data ? credits(account.data.app_used_quota) : '—'}</Text></View><View style={styles.walletBottom}><Text style={styles.walletNote}>{t('account.quotaDescription')}</Text><Action title={t('account.topup')} icon="plus" ghost onPress={() => openPanel('topup')} /></View>{account.error ? <Text accessibilityRole="alert" style={[styles.walletNote, { marginTop: 12 }]}>{t('account.loadFailed')}</Text> : null}</View>
    <View style={styles.accountActions}>{action('settings', t('account.settings'), t('settings.cloudGeneralDescription'), () => openPanel('settings'))}{action('bell', t('support.notifications'), inbox.data?.unread ? local(`${inbox.data.unread} 条未读通知`, `${inbox.data.unread} unread notifications`) : local('接收处理结果与重要消息', 'Replies and important updates'), () => navigation.navigate('Notifications'))}{action('scan-text', t('support.title'), t('support.accountDescription'), () => navigation.navigate('Compose'))}</View>
    <View style={styles.usage}><View style={styles.between}><View style={styles.grow}><Text style={styles.title}>{t('account.usage')}</Text><Text style={[styles.small, { marginTop: 8 }]}>{t('account.usageScope')}</Text></View><IconButton name="refresh" label={t('account.refreshUsage')} disabled={usage.loading} onPress={usage.refresh} /></View>
      {usage.loading ? <ActivityIndicator color={colors.accent} /> : usage.error ? <><Text style={styles.error}>{t('account.usageFailed')}</Text><Action ghost title={t('account.retryUsage')} onPress={usage.refresh} /></> : !usage.data?.items.length ? <Text style={styles.secondary}>{t('account.usageEmpty')}</Text> : usage.data.items.map(item => <View key={item.id} style={styles.usageItem}><View style={styles.between}><Text style={[styles.body, styles.grow]}>{item.model_name || t('account.usageUnknownModel')}</Text><Text style={styles.body}>{credits(item.quota)} {local('积分', 'credits')}</Text></View><Text style={styles.small}>{date(new Date(item.created_at * 1000).toISOString())}</Text></View>)}
      <View style={styles.between}><Action title={t('account.previousPage')} ghost disabled={usage.loading || page === 1} onPress={() => setPage(value => value - 1)} /><Text style={styles.small}>{page} / {Math.max(1, Math.ceil((usage.data?.total || 0) / 10))}</Text><Action title={t('account.nextPage')} ghost disabled={usage.loading || !usage.data || page * 10 >= usage.data.total || page >= 10000} onPress={() => setPage(value => value + 1)} /></View>
    </View><View style={styles.accountFooter}><Action title={t('cloud.logout')} ghost onPress={logout} /></View>
  </ScrollView>;
}
function Home({ navigation }: NativeStackScreenProps<Routes, 'Home'>) {
  const api = useApi();
  const [tab, setTab] = useState<'projects' | 'creation' | 'skills' | 'account'>('projects');
  const [currentProject, setCurrentProject] = useState<Project>();
  const [visited, setVisited] = useState(['projects']);
  useEffect(() => { setVisited(value => value.includes(tab) ? value : [...value, tab]); }, [tab]);
  const open = (project: Project) => { performance.mark('shotloom-native-canvas-open'); setCurrentProject(current => current?.id === project.id ? current : project); setTab('creation'); };
  useFocusEffect(useCallback(() => {
    if (tab !== 'creation') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { setTab('projects'); return true; });
    return () => listener.remove();
  }, [tab]));
  const tabs: Array<{ id: 'projects' | 'creation' | 'skills' | 'account'; label: string; icon: IconName }> = [
    { id: 'projects', label: t('ui.ProjectScopeHeader.text.79b705bd'), icon: 'folder' },
    { id: 'creation', label: t('ui.navigation.label.a1fce3b0'), icon: 'grid' },
    { id: 'skills', label: t('ui.navigation.label.53da139b'), icon: 'puzzle' },
    { id: 'account', label: t('account.title'), icon: 'user' },
  ];
  return <SafeAreaView style={styles.screen}><StatusBar barStyle="dark-content" backgroundColor={colors.background} /><View style={styles.grow}>
    {visited.includes('projects') && <View style={[styles.screen, tab !== 'projects' && styles.parkedWorkspace]} pointerEvents={tab === 'projects' ? 'auto' : 'none'} accessibilityElementsHidden={tab !== 'projects'} importantForAccessibility={tab === 'projects' ? 'auto' : 'no-hide-descendants'}><PageActive.Provider value={tab === 'projects'}><Projects navigation={navigation} onOpen={open} /></PageActive.Provider></View>}
    {visited.includes('account') && <View style={[styles.screen, tab !== 'account' && styles.parkedWorkspace]} pointerEvents={tab === 'account' ? 'auto' : 'none'} accessibilityElementsHidden={tab !== 'account'} importantForAccessibility={tab === 'account' ? 'auto' : 'no-hide-descendants'}><PageActive.Provider value={tab === 'account'}><Account navigation={navigation} /></PageActive.Provider></View>}
    {visited.includes('skills') && <View style={[styles.screen, tab !== 'skills' && styles.parkedWorkspace]} pointerEvents={tab === 'skills' ? 'auto' : 'none'} accessibilityElementsHidden={tab !== 'skills'} importantForAccessibility={tab === 'skills' ? 'auto' : 'no-hide-descendants'}><NativeSkills api={api} active={tab === 'skills'} /></View>}
    {currentProject && <View style={[styles.screen, tab !== 'creation' && styles.parkedWorkspace]} pointerEvents={tab === 'creation' ? 'auto' : 'none'} accessibilityElementsHidden={tab !== 'creation'} importantForAccessibility={tab === 'creation' ? 'auto' : 'no-hide-descendants'}><WebContent key={currentProject.id} params={currentProject} active={tab === 'creation'} /></View>}
  </View><View accessibilityRole="tablist" style={styles.tabs}>{tabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: tab === item.id, disabled: item.id === 'creation' && !currentProject }} disabled={item.id === 'creation' && !currentProject} onPress={() => { if (item.id === 'creation') { if (currentProject) open(currentProject); } else setTab(item.id); }} style={({ pressed }) => [styles.tab, tab === item.id && styles.tabActive, item.id === 'creation' && !currentProject && styles.disabled, pressed && styles.pressed]}><Icon name={item.icon} color={tab === item.id ? colors.accent : colors.muted} /><Text style={[styles.tabText, tab === item.id && styles.tabTextActive]}>{item.label}</Text></Pressable>)}</View></SafeAreaView>;
}
function SupportTabs({ active, navigation }: { active: 'Compose' | 'Records'; navigation: Pick<NativeStackScreenProps<Routes, 'Home'>['navigation'], 'navigate'> }) {
  const tabs = [{ route: 'Compose' as const, label: t('support.submit') }, { route: 'Records' as const, label: t('support.history') }];
  return <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 28, borderBottomWidth: 1, borderColor: colors.line }} accessibilityRole="tablist">{tabs.map(tab => <Pressable key={tab.route} accessibilityRole="tab" accessibilityState={{ selected: active === tab.route }} style={{ minHeight: 48, justifyContent: 'center', borderBottomWidth: 2, borderColor: active === tab.route ? colors.accent : 'transparent' }} onPress={() => { if (active !== tab.route) navigation.navigate(tab.route); }}><Text style={{ fontSize: 13, lineHeight: 20, color: active === tab.route ? colors.accent : colors.text }}>{tab.label}</Text></Pressable>)}</ScrollView></View>;
}
function Records({ navigation }: NativeStackScreenProps<Routes, 'Records'>) {
  const [page, setPage] = useState(0);
  const { data, error, loading, refresh } = useRemote<Page<Feedback>>(`/feedback?offset=${page * 20}&limit=20`);
  return <SafeAreaView edges={['bottom']} style={styles.screen}><SupportTabs active="Records" navigation={navigation} />
    {error && <ErrorNotice text={error} retry={refresh} />}
    <FlatList data={data?.items || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.recordList}
      ListHeaderComponent={data?.items.length ? <Text style={styles.small}>{local(`${data.total} 条记录`, `${data.total} records`)}</Text> : null}
      ListEmptyComponent={!loading && !error ? <EmptyState title={t('support.empty')} description={local('提交反馈或举报后，可在这里跟进处理进度。', 'Follow the progress of submitted feedback and reports here.')} /> : null}
      renderItem={({ item }) => <Pressable accessibilityRole="button" style={({ pressed }) => [styles.recordCard, pressed && styles.pressed]} onPress={() => navigation.navigate('Feedback', { id: item.id })}>
        <View style={styles.between}><View style={styles.inline}><View style={styles.recordIcon}><Icon name={item.kind === 'report' ? 'target' : 'scan-text'} size={18} color={colors.accent} /></View><Text style={styles.title}>{t(`support.${item.kind}`)}</Text></View><View style={[styles.statusPill, item.status === 'resolved' ? styles.resolvedPill : item.status === 'processing' ? styles.processingPill : undefined]}><Text style={[styles.small, item.status === 'resolved' ? styles.resolvedText : item.status === 'processing' ? styles.processingText : undefined]}>{t(`support.${item.status}`)}</Text></View></View>
        <Text numberOfLines={3} style={styles.body}>{item.description}</Text><View style={styles.recordFooter}><Text style={styles.small}>{date(item.created_at)}</Text><View style={styles.inline}><Text style={styles.small}>{local('查看详情', 'View details')}</Text><Icon name="chevron-right" size={16} color={colors.muted} /></View></View>
      </Pressable>} />
    {(data?.total || 0) > 20 && <View style={styles.pager}><Action ghost title={local('上一页', 'Previous')} disabled={!page || loading} onPress={() => setPage(value => value - 1)} /><Text style={styles.small}>{page + 1} / {Math.ceil((data?.total || 0) / 20)}</Text><Action ghost title={local('下一页', 'Next')} disabled={loading || (page + 1) * 20 >= (data?.total || 0)} onPress={() => setPage(value => value + 1)} /></View>}
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
      // Revision 1 has no replies; a retried submission may already have a reply and needs a fresh detail.
      if (saved.revision === 1) api.setCached<FeedbackDetail>(`/feedback/${saved.id}`, { item: saved, replies: [] });
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
  const { data, error, loading, refresh, setData } = useRemote<InboxPage>(`/notifications?offset=${page * 20}&limit=20`);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async (operation: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setFailure('');
    try { await operation(); } catch (cause) { setFailure(errorText(cause)); }
    finally { running.current = false; setBusy(false); }
  };
  const markRead = async (id?: string) => {
    const asOf = data!.asOf;
    await api.request(id ? `/notifications/${id}/read` : '/notifications/read-all', 'PUT', id ? undefined : { asOf });
    const readAt = new Date().toISOString();
    setData(current => {
      if (!current || (!id && current.asOf !== asOf)) return current;
      const count = id ? current.items.filter(item => item.id === id && !item.read_at).length : current.unread;
      return { ...current, unread: Math.max(0, current.unread - count), items: current.items.map(item =>
        (!id || item.id === id) && !item.read_at ? { ...item, read_at: readAt } : item) };
    });
  };
  return <SafeAreaView edges={['bottom']} style={styles.screen}>
    <View style={styles.inboxHead}><Text style={styles.secondary}>{local('处理进度与后台回复，都在这里。', 'Follow updates and replies here.')}</Text>
      <View style={styles.inboxToolbar}><View style={styles.inline}><Text style={styles.title}>{local('全部消息', 'All messages')}</Text>{data ? <View style={styles.inboxCount}><Text style={styles.small}>{data.total}</Text></View> : null}</View>
        <View style={styles.inline}>{data?.unread ? <Pressable accessibilityRole="button" accessibilityLabel={t('support.readAll')} disabled={busy} onPress={() => void run(() => markRead())} style={({ pressed }) => [styles.inboxTextAction, pressed && styles.pressed, busy && styles.disabled]}><Icon name="check" size={16} color={colors.accent} /><Text style={styles.inboxActionText}>{t('support.readAll')}</Text></Pressable> : null}<IconButton name="refresh" label={t('support.refresh')} disabled={loading || busy} onPress={refresh} /></View>
      </View>{data?.unread ? <Text style={styles.small}>{local(`${data.unread} 条未读`, `${data.unread} unread`)}</Text> : null}
    </View>
    {(error || failure) ? <ErrorNotice text={error || failure} retry={refresh} /> : null}
    <FlatList data={data?.items || []} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.inboxList}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} /> : !error ? <View style={styles.inboxEmpty}><View style={styles.inboxEmptyIcon}><Icon name="bell" size={32} color={colors.accent} /></View><Text style={styles.title}>{local('暂无通知', 'No notifications')}</Text><Text style={styles.inboxEmptyHint}>{local('反馈有了新回复或处理进展，\n会在这里及时告诉你。', 'New replies and updates to your feedback\nwill appear here.')}</Text></View> : null}
      renderItem={({ item }) => <View style={[styles.inboxCard, !item.read_at && styles.inboxUnread]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('support.replyReceived')}, ${item.body}`} disabled={busy} onPress={() => void run(async () => { if (!item.read_at) await markRead(item.id); api.invalidate([`/feedback/${item.feedback_id}`]); navigation.navigate('Feedback', { id: item.feedback_id }); })} style={({ pressed }) => [styles.inboxMessage, pressed && styles.pressed]}>
          <View style={styles.recordIcon}><Icon name="scan-text" size={18} color={colors.accent} /></View><View style={[styles.grow, { gap: 8 }]}><View style={styles.between}><Text style={[styles.inboxTitle, !item.read_at && styles.inboxUnreadTitle]}>{t('support.replyReceived')}</Text>{!item.read_at ? <View accessibilityLabel={local('未读', 'Unread')} style={styles.unreadDot} /> : null}</View><Text numberOfLines={3} style={styles.secondary}>{item.body}</Text></View>
        </Pressable>
        <View style={styles.inboxFooter}><Text style={[styles.small, styles.grow]}>{date(item.created_at)}</Text>{!item.read_at ? <Pressable accessibilityRole="button" disabled={busy} accessibilityLabel={t('support.read')} style={({ pressed }) => [styles.inboxTextAction, pressed && styles.pressed]} onPress={() => void run(() => markRead(item.id))}><Icon name="check" size={14} color={colors.muted} /><Text style={styles.small}>{t('support.read')}</Text></Pressable> : <View style={styles.inline}><Text style={styles.small}>{local('查看回复', 'View reply')}</Text><Icon name="chevron-right" size={14} color={colors.muted} /></View>}</View>
      </View>} />
    {(data?.total || 0) > 20 && <View style={styles.pager}><Action ghost title={local('上一页', 'Previous')} disabled={!page || loading || busy} onPress={() => setPage(value => value - 1)} /><Text style={styles.small}>{page + 1} / {Math.ceil((data?.total || 0) / 20)}</Text><Action ghost title={local('下一页', 'Next')} disabled={loading || busy || (page + 1) * 20 >= (data?.total || 0)} onPress={() => setPage(value => value + 1)} /></View>}
  </SafeAreaView>;
}
function WorkspaceSession({ session, children }: { session: NativeSession; children: React.ReactNode }) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof workspaceSource>>>();
  const [readyToken, setReadyToken] = useState('');
  useEffect(() => {
    let active = true;
    setSource(undefined); setReadyToken('');
    // Warm only the cookie store and WebView engine; this page contains no workspace or account data.
    const timer = setTimeout(() => { active = false; setSource(undefined); }, 15000);
    void workspaceSource(origin, session.token, `${origin}/?native=prewarm`).then(value => { if (active) setSource(value); }).catch(() => {});
    return () => { active = false; clearTimeout(timer); };
  }, [session.token]);
  return <WorkspaceCookieReady.Provider value={readyToken === session.token}>{children}
    {source && <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}>
      <WebView source={source} sharedCookiesEnabled thirdPartyCookiesEnabled={false} mixedContentMode="never" setSupportMultipleWindows={false}
        onMessage={event => {
          try {
            if (new URL(event.nativeEvent.url).origin !== origin) return;
            const value = JSON.parse(event.nativeEvent.data);
            if (['workspace-cookie-ready', 'workspace-session-ready'].includes(value.type) && value.userId === session.userId) {
              setReadyToken(session.token);
              performance.mark(value.type === 'workspace-cookie-ready' ? 'shotloom-native-cookie-ready' : 'shotloom-native-preload-complete');
              if (value.type === 'workspace-session-ready') setSource(undefined);
            }
          } catch { /* A failed warmup falls back to the normal one-time handoff. */ }
        }} onError={() => setSource(undefined)} onHttpError={() => setSource(undefined)} />
    </View>}
  </WorkspaceCookieReady.Provider>;
}
function WebContent({ params, active = true }: { params: Routes['Workspace']; active?: boolean }) {
  const api = useApi();
  const session = useContext(SessionContext)!;
  const cookieReady = useContext(WorkspaceCookieReady);
  const webview = useRef<WebView>(null);
  const { revision } = useContext(SettingsChanged);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (active && ready) webview.current?.injectJavaScript("performance.mark('shotloom-workspace-reveal');requestAnimationFrame(()=>requestAnimationFrame(()=>{performance.mark('shotloom-workspace-visible');window.ReactNativeWebView?.postMessage(JSON.stringify({type:'workspace-visible'}));}));true;");
  }, [active, ready]);
  useEffect(() => { if (revision) webview.current?.injectJavaScript("window.dispatchEvent(new Event('shotloom-native-settings-changed')); true;"); }, [revision]);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const query = new URLSearchParams();
  if (params.id) { query.set('project', params.id); query.set('route', 'creation'); }
  else if (params.page) query.set('route', params.page);
  if (params.panel) query.set('panel', params.panel);
  if (params.folder) query.set('folder', params.folder);
  query.set('native', 'embedded');
  const target = `${origin}/?${query}`;
  const [source, setSource] = useState<Awaited<ReturnType<typeof workspaceSource>> | { uri: string }>();
  const reuseCookie = useRef(cookieReady);
  const document = useRef({ target: '', retry: -1 });
  useEffect(() => {
    let active = true;
    const recovering = Boolean(webview.current && document.current.target === target && document.current.retry === retry);
    if (!recovering) { setSource(undefined); setReady(false); }
    setError('');
    if (!recovering && reuseCookie.current && retry === 0) {
      document.current = { target, retry }; setSource({ uri: target });
      return () => { active = false; };
    }
    void workspaceSource(origin, session.token, target).then(value => {
      if (!active) return;
      if (recovering) {
        // Refresh HttpOnly cookies in place so reauthentication preserves unsaved canvas state.
        webview.current?.injectJavaScript(`(async()=>{if(location.origin!==${JSON.stringify(origin)})return;try{const r=await fetch(${JSON.stringify(value.uri)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:${JSON.stringify(value.body)}});if(!r.ok)throw new Error('HTTP '+r.status);window.dispatchEvent(new Event('focus'));}catch(e){window.ReactNativeWebView?.postMessage(JSON.stringify({type:'workspace-session-error',error:String(e.message||e)}));}})();true;`);
      } else {
        document.current = { target, retry }; setSource(value);
      }
    })
      .catch(cause => { if (active) { setError(errorText(cause)); if (cause.status === 401 || cause.code === 'ACCOUNT_CHANGED') session.expire(); } });
    return () => { active = false; };
  }, [session.token, target, retry]);
  // The workspace can report display readiness, but has no API/tool request bridge.
  const injected = `window.__SHOTLOOM_MOBILE__ = true; try { localStorage.setItem('shotloom:locale', ${JSON.stringify(language)}); } catch {} document.documentElement.dataset.nativeEmbedded='true'; true;`;
  return <View style={styles.screen}>{error && <ErrorNotice text={error} retry={() => { setError(''); setReady(false); setRetry(value => value + 1); }} />}
    {source && <WebView ref={webview} key={retry} source={source} style={[styles.screen, !ready && !error && { opacity: 0 }]} sharedCookiesEnabled thirdPartyCookiesEnabled={false} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }}
      injectedJavaScriptObject={{ userId: session.userId, locale: language }}
      onLoadStart={() => performance.mark('shotloom-native-document-start')} onLoadEnd={() => performance.mark('shotloom-native-document-loaded')}
      onMessage={event => { try { if (new URL(event.nativeEvent.url).origin !== origin) return; const value = JSON.parse(event.nativeEvent.data); if (value.type === 'workspace-blocked' && value.status === 'login' && reuseCookie.current && retry === 0 && !ready) { reuseCookie.current = false; setRetry(value => value + 1); return; } if (value.type === 'workspace-visible') { performance.mark('shotloom-native-canvas-visible'); return; } if (value.type === 'workspace-ready' || value.type === 'workspace-blocked') { setReady(true); if (value.status === 'login' || value.status === 'account') session.expire(); } else if (value.type === 'workspace-session-error') setError(String(value.error)); else if (value.type === 'workspace-mutated') api.invalidateWrite(typeof value.path === 'string' ? value.path : ''); } catch {} }}
      mixedContentMode="never" setSupportMultipleWindows={false} injectedJavaScriptBeforeContentLoaded={injected} onError={event => setError(event.nativeEvent.description)} onHttpError={event => setError(`HTTP ${event.nativeEvent.statusCode}`)} />}
    {!ready && !error && <View style={[styles.empty, { position: 'absolute', inset: 0, backgroundColor: colors.background }]}><ActivityIndicator color={colors.accent} /><Text style={styles.secondary}>{params.id ? local('正在打开画布…', 'Opening canvas…') : local('正在打开页面…', 'Opening page…')}</Text></View>}
  </View>;
}
function Settings() {
  const api = useApi();
  const { changed } = useContext(SettingsChanged);
  return <NativeSettings api={api} onChanged={changed} />;
}
function Workspace({ route }: NativeStackScreenProps<Routes, 'Workspace'>) {
  return <SafeAreaView edges={route.params.id ? ['top', 'bottom'] : ['bottom']} style={styles.screen}><WebContent params={route.params} /></SafeAreaView>;
}
export default function App() {
  const [session, setSession] = useState<NativeSession | null>(null);
  const loggingOut = useRef(false);
  const signingIn = useRef(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const changed = useCallback(() => setSettingsRevision(value => value + 1), []);
  const [opened, setOpened] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [failure, setFailure] = useState('');
  const api = useMemo(() => {
    if (!session) return null;
    const value = createNativeApi(origin, session.token, randomUUID, () => { value.pause(); setAuthenticated(false); });
    return value;
  }, [session]);
  useEffect(() => {
    let active = true;
    void restoreSession(origin).then(value => { if (active) setSession(value); })
      .catch(cause => { if (active) setFailure(errorText(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!api || !session) return;
    let active = true;
    setLoading(true);
    void api.read<{ locale?: string }>('/settings/mobile').then(preferences => {
      if (active && preferences.locale) { setLanguage(preferences.locale); changed(); }
    }).catch(() => {});
    void api.read<{ id: string }>('/auth/me').then(user => {
      if (!active) return;
      if (user.id !== session.userId) throw new Error(t('cloud.login.accountChanged'));
      setAuthenticated(true); setOpened(true); setFailure('');
    }).catch(cause => { if (active) { setAuthenticated(false); setFailure(errorText(cause)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; api.invalidate(); api.disconnect(); };
  }, [api, session, changed]);
  const signIn = async () => {
    if (signingIn.current) return;
    signingIn.current = true; setBusy(true); setFailure('');
    try {
      const value = await login(origin, opened ? session?.userId : undefined);
      if (value) setSession(value);
    } catch (cause) { setFailure(errorText(cause)); }
    finally { signingIn.current = false; setBusy(false); }
  };
  const logout = async () => {
    if (loggingOut.current || !api) return;
    loggingOut.current = true; setBusy(true); setFailure('');
    try {
      api.disconnect(); api.resume();
      try { await api.request('/auth/logout', 'POST'); }
      catch (cause) { if (![401, 403].includes((cause as { status?: number }).status || 0)) throw cause; }
      await clearSession(origin);
      api.invalidate(); api.disconnect(); setSession(null); setOpened(false); setAuthenticated(false);
    } catch (cause) { setFailure(errorText(cause)); }
    finally { loggingOut.current = false; setBusy(false); }
  };
  return <SafeAreaProvider><View style={styles.screen}><ApiContext.Provider value={api}><SessionContext.Provider value={session ? { ...session, expire: () => { api?.pause(); setAuthenticated(false); } } : null}><SettingsChanged.Provider value={{ revision: settingsRevision, changed }}><LogoutContext.Provider value={() => void logout()}>
    {authenticated && failure ? <ErrorNotice text={failure} /> : null}
    {opened && session && <WorkspaceSession session={session}><View style={styles.screen} pointerEvents={authenticated ? 'auto' : 'none'} accessibilityElementsHidden={!authenticated} importantForAccessibility={authenticated ? 'auto' : 'no-hide-descendants'}><NavigationContainer linking={{ prefixes: ['shotloom-preview://'], config: { screens: { Feedback: 'feedback/:id', Notifications: 'notifications' } } }}>
      <Stack.Navigator screenOptions={{ headerBackButtonDisplayMode: 'minimal', contentStyle: styles.screen, headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerTitleStyle: { fontSize: 16, fontWeight: '500' } }}>
        <Stack.Screen name="Home" component={Home} options={{ headerShown: false }} />
        <Stack.Screen name="Settings" component={Settings} options={{ title: t('account.settings') }} />
        <Stack.Screen name="Compose" component={Compose} options={{ title: t('support.title'), headerStyle: { backgroundColor: colors.surface } }} />
        <Stack.Screen name="Records" component={Records} options={{ title: t('support.history') }} />
        <Stack.Screen name="Feedback" component={Thread} options={{ title: t('support.title') }} />
        <Stack.Screen name="Notifications" component={Notifications} options={{ title: t('support.notifications') }} />
        <Stack.Screen name="Workspace" component={Workspace} options={({ route }) => ({ title: route.params.name, headerShown: !route.params.id })} />
      </Stack.Navigator>
    </NavigationContainer></View></WorkspaceSession>}
    {!authenticated && <SafeAreaView style={styles.loginBridge}><ScrollView contentContainerStyle={[styles.list, { justifyContent: 'center' }]}>
      <View style={[styles.row, { padding: 28, gap: 24 }]}>
        <View style={styles.inline}><Image source={require('../assets/shotloom-logo.png')} style={{ width: 44, height: 44, borderRadius: 12 }} /><Text style={styles.heading}>Shotloom</Text></View>
        <Text style={styles.heading}>{t('cloud.login.title')}</Text>
        <Text style={styles.secondary}>{opened ? local('登录已过期，请使用原账号继续。', 'Your session expired. Sign in with the same account to continue.') : t('cloud.login.description')}</Text>
        {failure ? <Text accessibilityRole="alert" style={styles.error}>{failure}</Text> : null}
        {(loading || busy) && <ActivityIndicator color={colors.accent} />}
        <Action title={busy ? t('cloud.login.loading') : t('cloud.login.action')} disabled={loading || busy} onPress={() => void signIn()} />
        {opened && <Action title={t('cloud.logout')} ghost disabled={loading || busy} onPress={() => void logout()} />}
      </View>
    </ScrollView></SafeAreaView>}
  </LogoutContext.Provider></SettingsChanged.Provider></SessionContext.Provider></ApiContext.Provider></View></SafeAreaProvider>;
}
