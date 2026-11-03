import { t } from '@/i18n';
import { create } from 'zustand';

export type ToastTone = 'default' | 'success' | 'warning' | 'error';
export interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
  duration: number;
}
export interface MessageDialog {
  id: number;
  title: string;
  message: string;
  tone: ToastTone;
  details?: string;
}
interface NotificationState {
  toasts: ToastMessage[];
  messages: MessageDialog[];
  showToast: (message: string, tone?: ToastTone) => void;
  dismissToast: (id: number) => void;
  showMessage: (message: string, options?: Partial<Omit<MessageDialog, 'id' | 'message'>>) => void;
  dismissMessage: (id: number) => void;
}

let nextId = 0;
const titles = (): Record<ToastTone, string> => ({
  default: t('notification.info'), success: t('notification.success'), warning: t('notification.warning'), error: t('notification.error'),
});
// 唯一跨层通知入口；不持久化、不解析文案猜测严重程度，由调用方指定。
export const useNotificationStore = create<NotificationState>((set) => ({
  toasts: [],
  messages: [],
  showToast: (message, tone = 'default') => {
    if (!String(message || '').trim()) return;
    set(state => {
      if (state.toasts.some(item => item.message === message && item.tone === tone)) return state;
      return { toasts: [...state.toasts, {
        id: ++nextId, message: String(message), tone,
        duration: tone === 'error' || tone === 'warning' ? 0 : 3600,
      }] };
    });
  },
  dismissToast: id => set(state => ({ toasts: state.toasts.filter(item => item.id !== id) })),
  showMessage: (message, options = {}) => {
    if (!String(message || '').trim()) return;
    const tone = options.tone || 'default';
    set(state => {
      if (state.messages.some(item => item.message === message && item.title === (options.title || titles()[tone]) && item.details === options.details && item.tone === tone)) return state;
      return { messages: [...state.messages, {
        ...options, id: ++nextId, message: String(message), tone, title: options.title || titles()[tone],
      }] };
    });
  },
  dismissMessage: id => set(state => ({ messages: state.messages.filter(item => item.id !== id) })),
}));

export const showToast = (message: string, tone?: ToastTone) =>
  useNotificationStore.getState().showToast(message, tone);
export const showSuccessToast = (message: string) => showToast(message, 'success');
export const showMessage = (message: string, options?: Partial<Omit<MessageDialog, 'id' | 'message'>>) =>
  useNotificationStore.getState().showMessage(message, options);
export const showErrorMessage = (message: string, title = t('notification.error')) =>
  showMessage(message, { tone: 'error', title });
