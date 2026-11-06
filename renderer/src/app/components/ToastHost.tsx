import { t } from '@/i18n';
import { Modal } from "antd";
import { useEffect, useState } from "react";
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

/**
 * 重要结果用 antd Modal 承载：焦点陷阱、Esc、遮罩关闭和焦点返回触发元素都由它负责，
 * 这里只保留消息队列语义（标题、正文、可展开详情、待处理条数）。
 */
function MessagePopup({ item, pending }: { item: MessageDialog; pending: number }) {
  const dismiss = useNotificationStore(state => state.dismissMessage);
  const close = () => dismiss(item.id);
  return (
    <Modal
      open
      centered
      width={420}
      className="message-dialog-modal"
      title={(
        <span className="message-dialog-title">
          <MessageMark tone={item.tone} />
          <span>{item.title}</span>
        </span>
      )}
      onCancel={close}
      footer={(
        <div className="message-dialog-footer">
          <span>{pending > 0 ? t('notification.pendingMessages', { count: pending }) : ""}</span>
          <button type="button" className="button primary" autoFocus onClick={close}>{t('notification.acknowledge')}</button>
        </div>
      )}
    >
      <div className="message-dialog-content">
        <div className="message-dialog-copy">
          <p>{item.message}</p>
          {item.details && <details className="message-details"><summary>{t('notification.details')}</summary><pre>{item.details}</pre></details>}
        </div>
      </div>
    </Modal>
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
