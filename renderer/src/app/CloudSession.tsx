import { type ReactNode, useEffect, useState } from 'react';
import { bindCloudUser, cloudEnabled, cloudOrigin, cloudRequest } from '../services/cloudRequest';
import { t } from '../i18n';
import { SocialAuth } from './components/SocialAuth';

export function CloudSession({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'login' | 'error' | 'account'>(cloudEnabled ? 'loading' : 'ready');
  const [opened, setOpened] = useState(!cloudEnabled);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (location.pathname !== '/native') return;
    if (status === 'login' || status === 'account') window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'login' }));
    else if (status === 'error') window.ReactNativeWebView?.postMessage(JSON.stringify({ type: 'error', error: t('cloud.login.unavailable') }));
  }, [status]);
  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    const expired = () => setStatus('login');
    window.addEventListener('shotloom-session-expired', expired);
    const check = () => {
      void fetch(`${cloudOrigin}/api/auth/me`, { credentials: 'include' }).then(async response => {
        const user = response.ok ? (await response.json()).data as { id: string } : undefined;
        if (!active) return;
        if (user && !bindCloudUser(user.id)) { setStatus('account'); return; }
        setStatus(response.ok ? 'ready' : response.status === 401 ? 'login' : 'error');
        if (response.ok) setOpened(true);
      }).catch(() => { if (active) setStatus('error'); });
    };
    check();
    window.addEventListener('focus', check);
    return () => { active = false; window.removeEventListener('shotloom-session-expired', expired); window.removeEventListener('focus', check); };
  }, [retry]);
  if (status === 'loading' && !opened) return <main className="cloud-session-loading" role="status" aria-live="polite">
    <img src="/shotloom-logo.png" alt="Shotloom" width="48" height="48" />
    <span className="cloud-session-progress" aria-hidden="true" />
    <p>{t('cloud.login.loading')}</p>
  </main>;
  return <>{opened && children}{status !== 'ready' && <main className={`cloud-login${opened ? ' cloud-login-overlay' : ''}`}>
    <section className="cloud-login-card" aria-labelledby="cloud-login-title">
      <div className="cloud-login-intro">
        <p className="cloud-wordmark"><img src="/shotloom-logo.png" alt="" width="40" height="40" />Shotloom</p>
        <h1 id="cloud-login-title">{t('cloud.login.title')}</h1>
      </div>
      <div className="cloud-login-form"><p>{t('cloud.login.description')}</p>
      {status === 'loading' ? <p role="status">{t('cloud.login.loading')}</p> : status === 'error'
        ? <><p role="alert">{t('cloud.login.unavailable')}</p><button className="button primary" onClick={() => { setStatus('loading'); setRetry(value => value + 1); }}>{t('cloud.login.retry')}</button></>
        : <>{status === 'account' && <p role="alert">{t('cloud.login.accountChanged')}</p>}<SocialAuth recover={opened} /></>}
      {new URLSearchParams(location.search).get('auth') === 'error' && <p role="alert">{t('cloud.login.failed')}</p>}
      </div>
    </section>
  </main>}</>;
}

export function CloudLogout() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!cloudEnabled) return null;
  return <><button className="button ghost" disabled={busy} onClick={() => {
    setBusy(true); setError('');
    void (async () => {
      const { flushProjectCheckpoint } = await import('../store/projectStore');
      if (!await flushProjectCheckpoint({ force: true })) throw new Error('Save failed');
      await cloudRequest('/auth/logout', 'POST');
      location.reload();
    })().catch(() => { setError(t('cloud.logout.failed')); setBusy(false); });
  }}>{t('cloud.logout')}</button>{error && <span role="alert">{error}</span>}</>;
}
