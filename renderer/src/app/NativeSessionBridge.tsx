import { useEffect } from 'react';
import { cloudRequest } from '../services/cloudRequest';
import { nativeRequestAllowed, type NativeRequest } from '../../../shared/nativeBridge';
import { getLocale, t } from '../i18n';
import type { MobileSettings } from '../../../shared/mobileSettings';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void; injectedObjectJson?: () => string };
    __shotloomNativeRequest?: (request: NativeRequest) => void;
  }
}

export function NativeSessionBridge() {
  useEffect(() => {
    let active = true;
    const post = (value: unknown) => { if (active) window.ReactNativeWebView?.postMessage(JSON.stringify(value)); };
    window.__shotloomNativeRequest = request => {
      if (!request || typeof request.id !== 'string' || typeof request.method !== 'string'
        || typeof request.path !== 'string' || !nativeRequestAllowed(request.method, request.path)) {
        post({ type: 'response', id: request?.id, error: 'Request is unavailable', status: 403 }); return;
      }
      void cloudRequest(request.path, request.method, request.value)
        .then(async data => {
          if (request.method === 'GET' && request.path === '/catalog/skills') {
            const { builtInSkills, withoutBuiltInSkills } = await import('../services/builtInSkills');
            data = { ...withoutBuiltInSkills(data as Record<string, unknown>), systemSkillIds: builtInSkills.map(skill => skill.id) };
          }
          post({ type: 'response', id: request.id, data });
        })
        .catch(error => post({ type: 'response', id: request.id, error: error.message, status: error.status }));
    };
    void Promise.all([cloudRequest<{ id: string }>('/auth/me'), cloudRequest<MobileSettings>('/settings/mobile')])
      .then(([user, settings]) => post({ type: 'ready', userId: user.id, locale: settings.locale || getLocale() }))
      .catch(error => post(error.status === 401 ? { type: 'login' } : { type: 'error', error: error.message }));
    const expired = () => post({ type: 'login' });
    window.addEventListener('shotloom-session-expired', expired);
    return () => { active = false; delete window.__shotloomNativeRequest; window.removeEventListener('shotloom-session-expired', expired); };
  }, []);
  return <main className="cloud-session-loading" role="status"><p>{t('cloud.login.loading')}</p></main>;
}
