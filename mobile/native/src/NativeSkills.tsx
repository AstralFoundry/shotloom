import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';
import type { NativeApi } from './api';
import { colors, styles, Icon, IconButton, Button } from './ui';
import { local, t } from './i18n';
import { parseSkillImport, saveSkills, type Skill, type SkillCatalog } from './skills';

type Editor = { draft: Skill; original?: Skill; baseline: string };
const confirm = (title: string, description = '') => new Promise<boolean>(resolve => Alert.alert(title, description, [{ text: local('取消', 'Cancel'), style: 'cancel', onPress: () => resolve(false) }, { text: local('确认', 'Confirm'), onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
export function NativeSkills({ api, active: pageActive = true }: { api: NativeApi; active?: boolean }) {
  const [catalog, setCatalog] = useState<SkillCatalog | undefined>(() => api.cached('/catalog/skills'));
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<Editor>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [revision, setRevision] = useState(0);
  const force = useRef(false);
  const refresh = () => { force.current = true; setRevision(value => value + 1); };
  useFocusEffect(useCallback(() => {
    if (!pageActive) return;
    let active = true;
    const bypass = force.current; force.current = false;
    setLoading(api.cached('/catalog/skills') === undefined || bypass); setError('');
    void api.read<SkillCatalog>('/catalog/skills', bypass).then(value => { if (active) setCatalog(value); })
      .catch(cause => { if (active) setError(String(cause.message || cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, revision, pageActive]));
  const all = (catalog?.skills || []).filter(skill => !skill.builtIn && !catalog?.systemSkillIds?.includes(skill.id));
  const needle = query.trim().toLocaleLowerCase();
  const items = all.filter(skill => [skill.name, skill.id, skill.description, skill.category].join(' ').toLocaleLowerCase().includes(needle)).sort((a, b) => Number(b.enabled !== false) - Number(a.enabled !== false) || a.name.localeCompare(b.name));
  const run = async (operation: () => Promise<void>) => {
    if (running.current) return;
    running.current = true; setBusy(true); setError('');
    try { await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(false); }
  };
  const open = (original?: Skill) => {
    const draft = original ? JSON.parse(JSON.stringify(original)) as Skill : { id: randomUUID(), name: '', description: '', instructions: '', category: 'general', version: 1, enabled: true, agentIds: ['canvas-primary'] };
    setError(''); setEditor({ draft, original, baseline: JSON.stringify(draft) });
  };
  const close = async () => {
    if (busy || !editor) return;
    if (JSON.stringify(editor.draft) !== editor.baseline && !await confirm(local('放弃未保存的更改？', 'Discard unsaved changes?'))) return;
    setError(''); setEditor(undefined);
  };
  const patch = (value: Partial<Skill>) => setEditor(current => current ? { ...current, draft: { ...current.draft, ...value } } : current);
  const save = () => run(async () => {
    if (!editor) return;
    if (editor.original && JSON.stringify(editor.draft) === editor.baseline) { setEditor(undefined); return; }
    setCatalog(await saveSkills(api, [editor.draft], { create: !editor.original, expected: editor.original }));
    setEditor(undefined);
  });
  const importFiles = () => run(async () => {
    const result = await getDocumentAsync({ type: ['application/json', 'text/json'], multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    const imported: Skill[] = [];
    for (const asset of result.assets) {
      try { imported.push(...parseSkillImport(JSON.parse(await new File(asset.uri).text()))); }
      catch (cause) { throw new Error(`${asset.name}: ${cause instanceof Error ? cause.message : String(cause)}`); }
    }
    const collisions = imported.filter(skill => all.some(current => current.id === skill.id));
    if (collisions.length && !await confirm(local('替换同 ID 的技能？', 'Replace skills with matching IDs?'), collisions.map(skill => skill.name).join('\n'))) return;
    setCatalog(await saveSkills(api, imported));
  });
  const exportSelected = () => run(async () => {
    if (!await isAvailableAsync()) throw new Error(local('当前设备不支持分享文件。', 'File sharing is unavailable.'));
    const skills = all.filter(skill => selected.includes(skill.id)).map(({ updatedAt, ...skill }) => skill);
    if (!skills.length) return;
    const file = new File(Paths.cache, `shotloom-skills-${randomUUID()}.json`);
    file.create();
    file.write(JSON.stringify({ format: 'shotloom.skill-catalog', formatVersion: 1, exportedAt: new Date().toISOString(), skills }, null, 2));
    await shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: local('导出技能', 'Export skills') });
  });
  const field = (key: 'id' | 'name' | 'category' | 'description' | 'instructions', label: string, multiline = false) => editor && <View style={styles.field}><Text style={styles.body}>{label}</Text><TextInput accessibilityLabel={label} editable={!busy && (key !== 'id' || !editor.original)} value={editor.draft[key]} onChangeText={value => patch({ [key]: value })} multiline={multiline} textAlignVertical={multiline ? 'top' : 'center'} autoCapitalize={key === 'id' ? 'none' : 'sentences'} style={[styles.input, multiline && styles.description, key === 'instructions' && { minHeight: 240 }]} /></View>;
  return <View style={styles.screen}>
    <FlatList data={items} keyExtractor={item => item.id} refreshing={loading} onRefresh={refresh} contentContainerStyle={styles.skillList}
      ListHeaderComponent={<View style={styles.field}>
        <Text style={styles.heading}>{t('ui.SkillsView.title.53da139b')}</Text><Text style={styles.secondary}>{t('ui.SkillsView.description.0d36078e')}</Text>
        <View style={styles.search}><Icon name="search" size={18} color={colors.muted} /><TextInput accessibilityLabel={t('ui.SkillsView.placeholder.15dfafe9')} placeholder={t('ui.SkillsView.placeholder.15dfafe9')} value={query} onChangeText={setQuery} style={styles.searchInput} /></View>
        <View style={styles.skillTools}><Button title={local('新建技能', 'New skill')} icon="plus" disabled={busy || !catalog} onPress={() => open()} /><Button title={local('导入', 'Import')} icon="upload" ghost disabled={busy || !catalog} onPress={() => void importFiles()} /><Button title={local(`导出 (${selected.length})`, `Export (${selected.length})`)} icon="download" ghost disabled={busy || !selected.length} onPress={() => void exportSelected()} /></View>
        <View style={styles.between}><Text style={styles.small}>{local(`${all.length} 个技能 · ${all.filter(item => item.enabled !== false).length} 个已启用`, `${all.length} skills · ${all.filter(item => item.enabled !== false).length} enabled`)}</Text><Pressable accessibilityRole="checkbox" accessibilityLabel={local('选择全部', 'Select all')} accessibilityState={{ checked: items.length > 0 && items.every(item => selected.includes(item.id)) }} style={styles.selectAll} onPress={() => setSelected(items.length && items.every(item => selected.includes(item.id)) ? [] : items.map(item => item.id))}><Text style={styles.small}>{local('全选', 'Select all')}</Text></Pressable></View>
        {busy && !editor ? <ActivityIndicator color={colors.accent} /> : null}{error && !editor ? <View accessibilityRole="alert" style={styles.field}><Text style={styles.error}>{error}</Text><Button title={t('support.refresh')} ghost onPress={refresh} /></View> : null}
      </View>}
      ListEmptyComponent={!loading && !error ? <View style={styles.empty}><Icon name="puzzle" size={40} color={colors.accent} /><Text style={styles.title}>{local('暂无技能', 'No skills')}</Text><Text style={[styles.secondary, { textAlign: 'center' }]}>{query ? local('试试其他关键词', 'Try another search') : t('skill.empty.user')}</Text></View> : null}
      renderItem={({ item }) => <View style={[styles.skillCard, item.enabled === false && styles.skillDisabled]}>
        <View style={styles.inline}><Pressable accessibilityRole="checkbox" accessibilityLabel={local(`选择 ${item.name}`, `Select ${item.name}`)} accessibilityState={{ checked: selected.includes(item.id) }} style={styles.selectSkill} onPress={() => setSelected(value => value.includes(item.id) ? value.filter(id => id !== item.id) : [...value, item.id])}><Icon name={selected.includes(item.id) ? 'check' : 'square'} color={selected.includes(item.id) ? colors.accent : colors.muted} /></Pressable><Pressable accessibilityRole="button" style={styles.grow} onPress={() => open(item)}><Text style={styles.title}>{item.name}</Text><Text style={styles.small}>{item.category || 'general'} · v{item.version}</Text></Pressable><Switch accessibilityLabel={local(`启用 ${item.name}`, `Enable ${item.name}`)} value={item.enabled !== false} disabled={busy} trackColor={{ true: colors.accent }} onValueChange={enabled => void run(async () => setCatalog(await saveSkills(api, [{ ...item, enabled }], { expected: item })))} /></View>
        <Pressable accessibilityRole="button" onPress={() => open(item)}><Text numberOfLines={3} style={styles.secondary}>{item.description}</Text></Pressable>
        <View style={styles.between}><Text style={styles.small}>{item.enabled === false ? local('已停用', 'Disabled') : local('已启用', 'Enabled')}</Text><View style={styles.inline}><IconButton name="pencil" label={local('编辑技能', 'Edit skill')} disabled={busy} onPress={() => open(item)} /><IconButton name="trash" label={local('删除技能', 'Delete skill')} disabled={busy} onPress={() => void run(async () => { if (await confirm(local('删除技能？', 'Delete skill?'), item.name)) { setCatalog(await saveSkills(api, [], { remove: item })); setSelected(value => value.filter(id => id !== item.id)); } })} /></View></View>
      </View>} />
    <Modal visible={Boolean(editor)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => void close()}><SafeAreaView style={styles.screen}><View style={styles.editorHead}><Text style={[styles.title, styles.grow]}>{editor?.original ? local('编辑技能', 'Edit skill') : local('新建技能', 'New skill')}</Text><Button title={local('保存', 'Save')} disabled={busy} onPress={() => void save()} /><IconButton name="x" label={local('关闭', 'Close')} disabled={busy} onPress={() => void close()} /></View><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.grow}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {field('id', 'ID')}{field('name', local('名称', 'Name'))}{field('category', local('分类', 'Category'))}
      <View style={styles.field}><Text style={styles.body}>{local('版本', 'Version')}</Text><TextInput accessibilityLabel={local('版本', 'Version')} keyboardType="number-pad" editable={!busy} value={editor?.draft.version ? String(editor.draft.version) : ''} onChangeText={value => patch({ version: Number(value) })} style={styles.input} /></View>
      {field('description', local('何时使用', 'When to use'), true)}
      <View style={styles.field}><Text style={styles.body}>{t('ui.SkillEditorPanel.text.d2d4a376')}</Text><Text style={styles.small}>{t('ui.SkillEditorPanel.text.1c196856')}</Text>{(['canvas', 'editor', 'director', 'text'] as const).map(role => { const id = `${role}-primary`; const checked = editor?.draft.agentIds?.includes(id) || false; return <Pressable key={id} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.agentChoice} disabled={busy} onPress={() => patch({ agentIds: checked ? editor?.draft.agentIds?.filter(value => value !== id) : [...(editor?.draft.agentIds || []), id] })}><Icon name={checked ? 'check' : 'square'} color={checked ? colors.accent : colors.muted} /><Text style={styles.body}>{t(`agent.role.${role}`)}</Text></Pressable>; })}</View>
      {field('instructions', local('技能指令', 'Instructions'), true)}
    </ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>
  </View>;
}
