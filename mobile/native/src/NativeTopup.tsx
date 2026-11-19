import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { dismissBrowser, openBrowserAsync } from 'expo-web-browser';
import type { NativeApi } from './api';
import { language, local, t } from './i18n';
import { Button, colors, Icon, styles } from './ui';

const formatCredits = (quota: number) => (quota / 10000).toLocaleString(language, { maximumFractionDigits: 4 });

export function NativeTopup({ api }: { api: NativeApi }) {
  const [amount, setAmount] = useState('10');
  const [rate, setRate] = useState<number>();
  const [balance, setBalance] = useState(() => api.cached<{ app_quota: number }>('/auth/account')?.app_quota);
  const [checkout, setCheckout] = useState<{ url: string; amount: string }>();
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const paying = useRef(false);
  const mounted = useRef(false);
  const focused = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const validAmount = /^\d+$/.test(amount) && Number.isInteger(Number(amount)) && Number(amount) >= 1 && Number(amount) <= 1_000_000;
  const refresh = useCallback(async () => {
    if (mounted.current) { setRefreshing(true); setError(''); }
    try {
      const account = await api.read<{ app_quota: number }>('/auth/account', true);
      if (mounted.current) setBalance(account.app_quota);
    } catch { if (mounted.current) setError(t('account.loadFailed')); }
    finally { if (mounted.current) setRefreshing(false); }
  }, [api]);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    void refresh();
    void api.read<{ quotaPerAmount: number }>('/auth/topup/options').then(value => {
      if (!Number.isFinite(value.quotaPerAmount) || value.quotaPerAmount <= 0) throw new Error('Invalid rate');
      if (mounted.current) setRate(value.quotaPerAmount);
    }).catch(() => { if (mounted.current) setError(t('account.rateFailed')); });
    let previous = AppState.currentState;
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active' && previous !== 'active') void refresh();
      previous = state;
    });
    const returned = Linking.addEventListener('url', event => {
      try {
        const url = new URL(event.url);
        if (url.protocol !== 'shotloom-preview:' || url.host !== 'payment' || url.pathname !== '/return') return;
        if (Platform.OS === 'ios') void dismissBrowser().catch(() => {});
        void refresh();
      } catch { /* Unrelated or malformed links cannot affect a checkout. */ }
    });
    return () => { focused.current = false; foreground.remove(); returned.remove(); };
  }, [api, refresh]));
  const pay = async () => {
    if (!validAmount || paying.current || !rate) return;
    paying.current = true; setBusy(true); setError('');
    try {
      let url = checkout?.amount === amount ? checkout.url : undefined;
      if (!url) {
        const result = await api.request<{ checkoutUrl: string }>('/auth/topup', 'POST', { amount: Number(amount) });
        const target = new URL(result.checkoutUrl);
        if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Invalid checkout URL');
        url = target.toString();
        if (!mounted.current) return;
        setCheckout({ url, amount });
      }
      if (!focused.current) return;
      await openBrowserAsync(url);
      if (mounted.current) await refresh();
    } catch { if (mounted.current) setError(t('account.topupFailed')); }
    finally { paying.current = false; if (mounted.current) setBusy(false); }
  };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page}>
    <View style={s.intro}><View style={styles.actionIcon}><Icon name="plus" color={colors.accent} /></View><Text style={styles.heading}>{t('account.topup')}</Text><Text style={styles.secondary}>{t('account.topupDescription')}</Text></View>
    <View style={styles.wallet}><Text style={[styles.body, styles.white]}>{t('account.quota')}</Text><Text style={styles.quota}>{balance === undefined ? '—' : formatCredits(balance)}</Text><Text style={styles.walletNote}>{t('account.quotaDescription')}</Text></View>
    <View style={s.card}><Text style={styles.title}>{t('account.amount')}</Text><View accessibilityRole="radiogroup" style={s.options}>{[10, 20, 50, 100].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: Number(amount) === value, disabled: busy }} disabled={busy} onPress={() => { setAmount(String(value)); setCheckout(undefined); }} style={({ pressed }) => [s.option, Number(amount) === value && styles.chosen, pressed && styles.pressed]}><Text style={s.number}>{value} <Text style={styles.small}>{t('account.amountUnit')}</Text></Text><Text style={styles.small}>{t('account.creditAmount', { value: rate ? formatCredits(value * rate) : '—' })}</Text></Pressable>)}</View>
      <Text style={styles.body}>{t('account.customAmount')}</Text><TextInput accessibilityLabel={t('account.customAmount')} value={amount} editable={!busy} onChangeText={value => { setAmount(value); setCheckout(undefined); }} inputMode="numeric" keyboardType="number-pad" maxLength={7} style={styles.input} />
      <View style={s.estimate}><Text style={styles.secondary}>{t('account.receiveCredits')}</Text><Text style={styles.heading}>{t('account.creditAmount', { value: validAmount && rate ? formatCredits(Number(amount) * rate) : '—' })}</Text><Text style={styles.small}>{rate ? t('account.creditRate', { value: formatCredits(rate) }) : t('account.rateLoading')}</Text></View>
      <Text style={styles.small}>{t('account.paymentNote')}</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy && <ActivityIndicator color={colors.accent} />}<Button title={busy ? t('account.creatingPayment') : checkout ? local('继续付款', 'Resume payment') : t('account.pay')} disabled={busy || !validAmount || !rate} onPress={() => void pay()} />
    </View>
    <View style={styles.row}><Text style={styles.title}>{local('付款后返回 APP', 'Return after payment')}</Text><Text style={styles.secondary}>{local('付款页面完成后点击“返回 APP”。回到这里会自动刷新余额；如暂未到账，可稍后再次刷新。', 'Choose “Return to app” after paying. Your balance refreshes when you return; refresh again later if credits are still pending.')}</Text><Button ghost title={local('已支付，刷新余额', 'Refresh balance after payment')} disabled={refreshing} onPress={() => void refresh()} /></View>
  </ScrollView>;
}

const s = StyleSheet.create({
  page: { padding: 20, gap: 20, maxWidth: 640, width: '100%', alignSelf: 'center' },
  intro: { gap: 12, paddingVertical: 8 },
  card: { padding: 20, gap: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.surface },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  option: { flexBasis: '45%', flexGrow: 1, minHeight: 88, padding: 14, gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  number: { fontSize: 22, lineHeight: 30, fontWeight: '600', color: colors.text },
  estimate: { padding: 16, gap: 8, borderRadius: 12, backgroundColor: colors.wash },
});
