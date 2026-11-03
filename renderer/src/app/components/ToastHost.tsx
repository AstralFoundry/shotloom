import { t } from '@/i18n';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CircleCheck, CircleAlert, Info, X } from "lucide-react";
import { useNotificationStore, type MessageDialog, type ToastMessage, type ToastTone } from "../../store/notificationStore";

const marks = { default: Info, success: CircleCheck, warning: CircleAlert, error: CircleAlert };
function MessageMark({ tone }: { tone: ToastTone }) {
  const Mark = marks[tone];
  return <span className={`message-mark message-${tone}`}><Mark size={18} strokeWidth={1.7} aria-hidden="true" /></span>;
}

function ToastCard({ item }: { item: ToastMessage }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const dismiss = useNotificationStore(state => state.dismissToast);
  useEffect(() => {
    if (!item.duration || hovered || focused) return;
    const timer = window.setTimeout(() => dismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item, hovered, focused, dismiss]);
  return (
    <div className="toast" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <MessageMark tone={item.tone} />
      <span className="toast-text" role={item.tone === "error" ? "alert" : "status"}>{item.message}</span>
      <button type="button" className="message-close" aria-label={t('notification.closeToast')} onClick={() => dismiss(item.id)}><X size={14} strokeWidth={1.7} /></button>
    </div>
  );
}

function MessagePopup({ item, pending }: { item: MessageDialog; pending: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const acknowledge = useRef<HTMLButtonElement>(null);
  const dismiss = useNotificationStore(state => state.dismissMessage);
  useLayoutEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    acknowledge.current?.focus();
    return () => {
      element?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  const close = () => dismiss(item.id);
  return (
    <dialog ref={dialog} className="message-dialog" aria-labelledby={`message-title-${item.id}`}
      aria-describedby={`message-body-${item.id}`} onCancel={event => { event.preventDefault(); close(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, summary"));
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} onKeyUp={event => event.stopPropagation()}>
      <button type="button" className="message-close message-dialog-close" aria-label={t('notification.closeMessage')} onClick={close}><X size={16} strokeWidth={1.7} /></button>
      <div className="message-dialog-content">
        <MessageMark tone={item.tone} />
        <div className="message-dialog-copy">
          <h2 id={`message-title-${item.id}`}>{item.title}</h2>
          <p id={`message-body-${item.id}`}>{item.message}</p>
          {item.details && <details className="message-details"><summary>{t('notification.details')}</summary><pre>{item.details}</pre></details>}
        </div>
      </div>
      <footer className="message-dialog-footer">
        <span>{pending > 0 ? t('notification.pendingMessages', { count: pending }) : ""}</span>
        <button type="button" className="button primary" ref={acknowledge} onClick={close}>{t('notification.acknowledge')}</button>
      </footer>
    </dialog>
  );
}

export function ToastHost() {
  const toasts = useNotificationStore(state => state.toasts);
  const messages = useNotificationStore(state => state.messages);
  return <>
    {messages.length === 0 && <div className="toast-stack" aria-label={t('notification.region')}>{toasts.slice(0, 3).map(item => <ToastCard key={item.id} item={item} />)}{toasts.length > 3 && <span className="toast-pending">{t('notification.pendingToasts', { count: toasts.length - 3 })}</span>}</div>}
    {messages[0] && <MessagePopup key={messages[0].id} item={messages[0]} pending={messages.length - 1} />}
  </>;
}
