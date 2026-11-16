import { useEffect, useState } from 'react';
import { InputNumber } from 'antd';
import { cloudEnabled, cloudRequest } from '../../services/cloudRequest';
import { t } from '../../i18n';
import { CloudLogout } from '../CloudSession';
import { IconSymbol } from '../components/IconSymbol';
import { formatCredits, formatTime } from '../../utils/format';
import { openFeedbackCenter } from '../components/SupportCenter';

type Account = { username?: string; email?: string; app_quota: number; app_used_quota: number };
type UsagePage = { total: number; page: number; page_size: number; items: { id: number; created_at: number; model_name: string; quota: number; prompt_tokens: number; completion_tokens: number }[] };

export function AccountView({ onSettings, onUpdate }: { onSettings: () => void; onUpdate?: (() => void) | undefined }) {
  const [account, setAccount] = useState<Account>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [topupOpen, setTopupOpen] = useState(cloudEnabled && new URLSearchParams(location.search).get('panel') === 'topup');
  const [amount, setAmount] = useState('10');
  const [paying, setPaying] = useState(false);
  const [checkoutUrl, setCheckoutUrl] = useState('');
  const [topupError, setTopupError] = useState('');
  const [quotaPerAmount, setQuotaPerAmount] = useState<number>();
  const [usage, setUsage] = useState<UsagePage>();
  const [usageError, setUsageError] = useState('');
  const [usageLoading, setUsageLoading] = useState(false);
  const [page, setPage] = useState(1);
  const validAmount = Number.isInteger(Number(amount)) && Number(amount) >= 1 && Number(amount) <= 1_000_000;
  useEffect(() => {
    if (!topupOpen) return;
    let active = true;
    setQuotaPerAmount(undefined);
    void cloudRequest<{ quotaPerAmount: number }>('/auth/topup/options')
      .then(value => { if (active) setQuotaPerAmount(value.quotaPerAmount); })
      .catch(() => { if (active) setTopupError(t('account.rateFailed')); });
    return () => { active = false; };
  }, [topupOpen]);
  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    setUsageLoading(true); setUsageError(''); setUsage(undefined);
    void cloudRequest<UsagePage>(`/auth/usage?page=${page}&page_size=10`)
      .then(value => { if (active) setUsage(value); })
      .catch(() => { if (active) setUsageError(t('account.usageFailed')); })
      .finally(() => { if (active) setUsageLoading(false); });
    return () => { active = false; };
  }, [page, retry]);
  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    const refresh = () => {
      setLoading(true); setError('');
      void cloudRequest<Account>('/auth/account').then(value => { if (active) setAccount(value); })
        .catch(() => { if (active) setError(t('account.loadFailed')); })
        .finally(() => { if (active) setLoading(false); });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [retry]);
  return <section className="account-view" aria-labelledby="account-title">
    <header className="account-header"><h1 id="account-title">{t('account.title')}</h1><p>{t('account.description')}</p></header>
    <div className="account-profile">
      <span className="account-avatar"><IconSymbol name="user" /></span>
      <div><h2>{account?.username || t('account.welcome')}</h2><p>{account?.email || 'new-api'}</p></div>
    </div>
    <div className="account-grid">
      {cloudEnabled && <section className="account-wallet" aria-label={t('account.quota')} aria-busy={loading}>
        <div className="account-wallet-heading"><span>{t('account.quota')}</span>
          <button className="account-refresh" aria-label={t('account.refresh')} title={t('account.refresh')} disabled={loading} onClick={() => setRetry(value => value + 1)}><IconSymbol name="refresh" /></button>
        </div>
        <strong>{account ? formatCredits(account.app_quota) : '—'}</strong>
        <p className="account-wallet-used">{t('account.used')}<span>{account ? formatCredits(account.app_used_quota) : '—'}</span></p>
        <div className="account-wallet-bottom"><p>{t('account.quotaDescription')}</p>
          <button className="button account-topup-trigger" onClick={() => { setCheckoutUrl(''); setTopupError(''); setTopupOpen(true); }}><IconSymbol name="plus" />{t('account.topup')}</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>}
      <div className="account-actions">
        <button className="account-action" onClick={onSettings}>
          <span className="account-action-icon"><IconSymbol name="settings" /></span>
          <span><strong>{t('account.settings')}</strong><small>{t(cloudEnabled ? 'settings.cloudGeneralDescription' : 'account.settingsDescription')}</small></span><IconSymbol name="chevron-right" />
        </button>
        {cloudEnabled && <button type="button" className="account-action" onClick={openFeedbackCenter}>
          <span className="account-action-icon"><IconSymbol name="scan-text" /></span>
          <span><strong>{t('support.title')}</strong><small>{t('support.accountDescription')}</small></span><IconSymbol name="chevron-right" />
        </button>}
      </div>
    </div>
    {onUpdate && <div className="account-mobile-tools">
      <button className="button ghost" onClick={onUpdate}><IconSymbol name="package" />{t('ui.SideBar.title.a6df3858')}</button>
    </div>}
    {cloudEnabled && <section className="account-usage" aria-labelledby="usage-title" aria-busy={usageLoading}>
      <header><div><h2 id="usage-title">{t('account.usage')}</h2><p>{t('account.usageScope')}</p></div>
        <button className="account-refresh" aria-label={t('account.refreshUsage')} disabled={usageLoading} onClick={() => setRetry(value => value + 1)}><IconSymbol name="refresh" /></button>
      </header>
      {usageLoading && <p role="status">{t('account.usageLoading')}</p>}
      {usageError && <div className="account-usage-error" role="alert"><p>{usageError}</p><button className="button ghost" onClick={() => setRetry(value => value + 1)}>{t('account.retryUsage')}</button></div>}
      {usage && (usage.items.length ? <ul>{usage.items.map(item => <li key={item.id}>
        <div><strong>{item.model_name || t('account.usageUnknownModel')}</strong><time dateTime={new Date(item.created_at * 1000).toISOString()}>{formatTime(item.created_at * 1000)}</time></div>
        <span className="account-usage-amount">{t('account.creditAmount', { value: formatCredits(item.quota) })}</span>
      </li>)}</ul> : <p>{t('account.usageEmpty')}</p>)}
      <footer aria-label={t('account.usagePagination')}>
        <button className="button ghost" disabled={usageLoading || page === 1} onClick={() => setPage(value => value - 1)}>{t('account.previousPage')}</button>
        <span>{t('account.usagePage', { page, pages: Math.max(1, Math.ceil((usage?.total || 0) / (usage?.page_size || 10))) })}</span>
        <button className="button ghost" disabled={usageLoading || !usage || page * usage.page_size >= usage.total || page >= 10000} onClick={() => setPage(value => value + 1)}>{t('account.nextPage')}</button>
      </footer>
    </section>}
    <footer className="account-footer"><CloudLogout /></footer>
    {topupOpen && <dialog className="account-topup" ref={element => { if (element && !element.open) element.showModal(); }} onCancel={() => { setTopupOpen(false); setCheckoutUrl(''); setRetry(value => value + 1); }} aria-labelledby="topup-title">
      <header><div><h2 id="topup-title">{t('account.topup')}</h2><p>{t(checkoutUrl ? 'account.checkoutDescription' : 'account.topupDescription')}</p></div><button className="button ghost account-topup-close" aria-label={t('account.close')} onClick={() => { setTopupOpen(false); setCheckoutUrl(''); setRetry(value => value + 1); }}><IconSymbol name="x" /></button></header>
      {checkoutUrl ? <>
        <div className="account-checkout-summary"><span>{t('account.topupAmount', { value: amount })}</span><strong>{t('account.creditAmount', { value: quotaPerAmount ? formatCredits(Number(amount) * quotaPerAmount) : '—' })}</strong></div>
        <div className="account-payment-handoff">
          <span className="account-action-icon"><IconSymbol name="link" /></span>
          <p>{t('account.checkoutDescription')}</p>
          <a className="button primary" href={checkoutUrl} target="_blank" rel="noopener noreferrer">{t('account.openPayment')}<IconSymbol name="link" /></a>
          <small>{t('account.paymentNote')}</small>
        </div></>
        : <form onSubmit={event => {
          event.preventDefault(); if (!validAmount || paying) return; setPaying(true); setTopupError('');
          void cloudRequest<{ checkoutUrl: string }>('/auth/topup', 'POST', { amount: Number(amount) })
            .then(value => setCheckoutUrl(value.checkoutUrl))
            .catch(() => setTopupError(t('account.topupFailed'))).finally(() => setPaying(false));
        }}>
          <div className="account-topup-options" role="group" aria-label={t('account.amount')}>
            {[10, 20, 50, 100].map(value => <button type="button" key={value} aria-pressed={Number(amount) === value} disabled={paying} onClick={() => setAmount(String(value))}>
              <strong>{value}<small>{t('account.amountUnit')}</small></strong><span>{t('account.creditAmount', { value: quotaPerAmount ? formatCredits(value * quotaPerAmount) : '—' })}</span>
            </button>)}
          </div>
          <div className="account-topup-custom"><label htmlFor="topup-amount">{t('account.customAmount')}</label>
            <InputNumber<string> id="topup-amount" stringMode inputMode="numeric" min="1" max="1000000" step="1" required disabled={paying} value={amount || null} onInput={setAmount} onChange={value => setAmount(value ?? '')} />
          </div>
          <div className="account-topup-preview" aria-live="polite"><span>{t('account.receiveCredits')}</span><strong>{t('account.creditAmount', { value: validAmount && quotaPerAmount ? formatCredits(Number(amount) * quotaPerAmount) : '—' })}</strong><small>{quotaPerAmount ? t('account.creditRate', { value: formatCredits(quotaPerAmount) }) : t('account.rateLoading')}</small></div>
          <p className="account-topup-note">{t('account.paymentNote')}</p>
          {topupError && <p role="alert">{topupError}</p>}
          <button className="button primary" disabled={paying || !validAmount}>{t(paying ? 'account.creatingPayment' : 'account.pay')}<IconSymbol name="chevron-right" /></button>
        </form>}
    </dialog>}
  </section>;
}
