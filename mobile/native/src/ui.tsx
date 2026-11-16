import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { paths, type IconName } from '../../../shared/iconPaths';

// Match renderer/styles/tokens.css and its mobile overrides.
export const colors = { background: '#fafafa', surface: '#ffffff', text: '#000000', muted: '#595959', line: 'rgba(0,0,0,0.08)', accent: '#6d6cff', wash: 'rgba(109,108,255,0.08)' };
export function Icon({ name, size = 20, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <SvgXml width={size} height={size} color={color} xml={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name]}</svg>`} />;
}
export function Button({ title, onPress, disabled = false, ghost = false, accent = false, icon }: { title: string; onPress: () => void; disabled?: boolean; ghost?: boolean; accent?: boolean; icon?: IconName }) {
  return <Pressable hitSlop={2} accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, accent && { backgroundColor: colors.accent, borderColor: colors.accent }, ghost && styles.ghost, pressed && styles.pressed, disabled && styles.disabled]}>
    {icon && <Icon name={icon} size={16} color={ghost ? colors.text : colors.surface} />}<Text style={[styles.buttonText, ghost && styles.ghostText]}>{title}</Text>
  </Pressable>;
}
export function IconButton({ name, label, onPress, light = false, disabled = false }: { name: IconName; label: string; onPress: () => void; light?: boolean; disabled?: boolean }) {
  return <Pressable hitSlop={2} accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed, disabled && styles.disabled]}><Icon name={name} size={18} color={light ? '#ffffff' : colors.text} /></Pressable>;
}
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: 20, gap: 20, flexGrow: 1 },
  actions: { padding: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  inline: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  between: { flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'space-between' },
  grow: { flex: 1, minWidth: 0 },
  row: { padding: 16, gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  heading: { fontSize: 24, lineHeight: 32, fontWeight: '600', color: colors.text },
  title: { fontSize: 16, lineHeight: 24, fontWeight: '500', color: colors.text },
  body: { fontSize: 14, lineHeight: 21, color: colors.text },
  secondary: { fontSize: 14, color: colors.muted, lineHeight: 21 },
  small: { fontSize: 12, lineHeight: 18, color: colors.muted },
  button: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10.2, backgroundColor: '#000000', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#000000' },
  buttonText: { fontSize: 14, lineHeight: 20, color: colors.surface, fontWeight: '500' },
  ghost: { backgroundColor: colors.surface, borderColor: colors.line },
  ghostText: { color: colors.text },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  pressed: { opacity: 0.65 }, disabled: { opacity: 0.4 },
  choice: { minHeight: 48, flex: 1, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chosen: { borderColor: colors.accent, backgroundColor: colors.wash },
  input: { minHeight: 48, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#d9d9d9', fontSize: 14, lineHeight: 21, color: colors.text, backgroundColor: colors.surface },
  description: { minHeight: 120 }, notice: { padding: 16, gap: 8 }, error: { color: '#c8443c', fontSize: 14, lineHeight: 21 },
  empty: { flexGrow: 1, paddingVertical: 32, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', gap: 12 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 4, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tab: { flex: 1, minHeight: 56, paddingVertical: 6, paddingHorizontal: 4, gap: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 10.2 },
  tabActive: { backgroundColor: colors.wash },
  tabText: { fontSize: 12, lineHeight: 18, color: colors.muted },
  tabTextActive: { color: colors.accent, fontWeight: '600' },
  projectList: { paddingTop: 20, paddingHorizontal: 16, paddingBottom: 88, gap: 12, flexGrow: 1 },
  projectHead: { paddingBottom: 16, marginBottom: 4, borderBottomWidth: 1, borderColor: colors.line, gap: 8 },
  projectActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  libraryHead: { gap: 12, marginBottom: 12 },
  search: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 12, minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: 10.2, backgroundColor: colors.surface },
  searchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 14, minHeight: 48, padding: 0 },
  projectCard: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, minHeight: 112, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  projectPreview: { width: 80, height: 80, borderRadius: 9.6, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center' },
  projectName: { fontSize: 15, lineHeight: 22, color: colors.text, fontWeight: '500', marginBottom: 6 },
  bell: { position: 'absolute', right: 16, bottom: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 28, elevation: 3 },
  badge: { position: 'absolute', right: 6, top: 6, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, color: colors.surface },
  account: { paddingVertical: 28, paddingHorizontal: 20, maxWidth: 960, width: '100%', alignSelf: 'center' },
  accountHeader: { gap: 8, marginBottom: 28 },
  profile: { flexDirection: 'row', gap: 16, alignItems: 'center', marginBottom: 28 },
  avatar: { width: 56, height: 56, borderRadius: 16.8, backgroundColor: colors.wash, alignItems: 'center', justifyContent: 'center' },
  profileName: { fontSize: 20, lineHeight: 28, fontWeight: '600', color: colors.text, marginBottom: 6 },
  wallet: { backgroundColor: '#000000', borderRadius: 20.4, paddingTop: 18, paddingHorizontal: 24, paddingBottom: 24, marginBottom: 24 },
  white: { color: '#ffffff' },
  quota: { color: '#ffffff', fontSize: 48, lineHeight: 58, fontWeight: '500', marginTop: 8, marginBottom: 20, letterSpacing: -1 },
  used: { color: '#bfbfbf', fontSize: 14, lineHeight: 21 },
  walletBottom: { marginTop: 28, paddingTop: 20, borderTopWidth: 1, borderColor: '#333333', gap: 18 },
  walletNote: { color: '#bfbfbf', fontSize: 12, lineHeight: 20.4 },
  accountActions: { gap: 12 },
  accountAction: { flexDirection: 'row', minHeight: 88, gap: 12, alignItems: 'center', padding: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 16.8 },
  actionIcon: { width: 44, height: 44, backgroundColor: colors.background, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  actionDescription: { fontSize: 14, lineHeight: 21, color: colors.muted, marginTop: 6 },
  usage: { marginTop: 28, borderWidth: 1, borderColor: colors.line, borderRadius: 16.8, backgroundColor: colors.surface, padding: 16, gap: 16 },
  usageItem: { borderTopWidth: 1, borderColor: colors.line, paddingTop: 16, gap: 6 },
  accountFooter: { marginTop: 24 },
  hiddenBridge: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  loginBridge: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: colors.surface },
});
