import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Empty, Form, Input, Modal, Pagination, Select, Space, Spin, Tabs, Tag, Typography } from 'antd';
import { cloudEnabled, cloudRequest } from '../../services/cloudRequest';
import { getLocale, t } from '../../i18n';
import { IconSymbol } from './IconSymbol';
import type { Feedback, FeedbackDetail, FeedbackKind, FeedbackStatus, InboxPage, Page } from '../../../../shared/support';

const date = (value: string) => new Date(value).toLocaleString(getLocale());
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const statuses: FeedbackStatus[] = ['pending', 'processing', 'resolved'];
const kinds: FeedbackKind[] = ['feedback', 'report'];
const statusOptions = () => statuses.map(value => ({ value, label: t(`support.${value}`) }));
const kindOptions = () => kinds.map(value => ({ value, label: t(`support.${value}`) }));

export function openFeedbackCenter() {
  window.dispatchEvent(new Event('shotloom-open-feedback'));
}

function FeedbackThread({ id, admin = false, onBack, onChanged }: {
  id: string; admin?: boolean; onBack: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<FeedbackDetail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState('');
  const [revision, setRevision] = useState(0);
  const replyRequest = useRef<{ body: string; replyId: string } | undefined>(undefined);
  const base = admin ? '/admin/feedback' : '/feedback';
  useEffect(() => {
    let active = true;
    setError('');
    void cloudRequest<FeedbackDetail>(`${base}/${id}`).then(value => { if (active) setDetail(value); })
      .catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [base, id, revision]);
  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); setRevision(value => value + 1); onChanged(); }
    catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  };
  return <section className="support-thread">
    <Button onClick={onBack} disabled={busy} icon={<IconSymbol name="arrow-left" />}>{t('support.back')}</Button>
    {error && <Alert type="error" title={error} action={<Button onClick={() => setRevision(value => value + 1)}>{t('support.refresh')}</Button>} />}
    {!detail && !error && <Spin />}
    {detail && <>
      <Space wrap><Tag>{t(`support.${detail.item.kind}`)}</Tag><Tag>{t(`support.${detail.item.status}`)}</Tag></Space>
      <Typography.Text copyable>{detail.item.id}</Typography.Text>
      <time>{date(detail.item.created_at)}</time>
      <p className="support-body">{detail.item.description}</p>
      {detail.item.reference && <p className="support-body"><strong>{t('support.reference')}: </strong>{detail.item.reference}</p>}
      <h3>{t('support.replies')}</h3>
      {!detail.replies.length && <Empty description={t('support.noReplies')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {detail.replies.map(reply => <article className="support-reply" key={reply.id}><time>{date(reply.created_at)}</time><p className="support-body">{reply.body}</p></article>)}
      {admin && <>
        <label htmlFor="feedback-status">{t('support.status')}</label>
        <Select id="feedback-status" aria-label={t('support.status')} value={detail.item.status} disabled={busy} options={statusOptions()}
          onChange={status => void mutate(() => cloudRequest(`${base}/${id}/status`, 'PUT', { status, revision: detail.item.revision }))} />
        <Form layout="vertical" onFinish={() => void mutate(async () => {
          if (replyRequest.current?.body !== body.trim()) replyRequest.current = { body: body.trim(), replyId: crypto.randomUUID() };
          await cloudRequest(`${base}/${id}/replies`, 'POST', replyRequest.current);
          setBody(''); replyRequest.current = undefined;
        })}>
          <Form.Item label={t('support.reply')} htmlFor="feedback-reply"><Input.TextArea id="feedback-reply" value={body} onChange={event => setBody(event.target.value)} maxLength={10000} autoSize={{ minRows: 4 }} disabled={busy} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy} disabled={!body.trim()}>{t('support.sendReply')}</Button>
        </Form>
      </>}
    </>}
  </section>;
}

function FeedbackList({ admin = false, onSelect, refresh }: { admin?: boolean; onSelect: (id: string) => void; refresh: number }) {
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<FeedbackKind>();
  const [status, setStatus] = useState<FeedbackStatus>();
  const [data, setData] = useState<Page<Feedback>>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ offset: String((page - 1) * 20), limit: '20', ...(kind ? { kind } : {}), ...(status ? { status } : {}) });
    void cloudRequest<Page<Feedback>>(`${admin ? '/admin' : ''}/feedback?${query}`).then(value => { if (active) setData(value); })
      .catch(cause => { if (active) setError(message(cause)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [admin, page, kind, status, refresh, retry]);
  return <section className="support-list">
    <Space wrap>
      {admin && <><Select allowClear placeholder={t('support.kind')} aria-label={t('support.kind')} options={kindOptions()} value={kind} onChange={value => { setKind(value); setPage(1); }} />
        <Select allowClear placeholder={t('support.status')} aria-label={t('support.status')} options={statusOptions()} value={status} onChange={value => { setStatus(value); setPage(1); }} /></>}
      <Button onClick={() => setRetry(value => value + 1)}>{t('support.refresh')}</Button>
    </Space>
    {error && <Alert type="error" title={error} />}
    {loading ? <Spin /> : !error && <>
      {!data?.items.length && <Empty description={t('support.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
      {data?.items.map(item => <button className="support-list-item" key={item.id} onClick={() => onSelect(item.id)}>
        <Space><Tag>{t(`support.${item.kind}`)}</Tag><Tag>{t(`support.${item.status}`)}</Tag></Space>
        <span className="support-excerpt">{item.description}</span><time>{date(item.created_at)}</time>
      </button>)}
      <Pagination current={page} pageSize={20} total={data?.total || 0} onChange={setPage} showSizeChanger={false} hideOnSinglePage />
    </>}
  </section>;
}

export function AdminFeedback() {
  const [selected, setSelected] = useState('');
  const [refresh, setRefresh] = useState(0);
  return selected ? <FeedbackThread key={selected} id={selected} admin onBack={() => setSelected('')} onChanged={() => setRefresh(value => value + 1)} />
    : <FeedbackList admin onSelect={setSelected} refresh={refresh} />;
}

export function SupportCenter() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('notifications');
  const [selected, setSelected] = useState('');
  const [inbox, setInbox] = useState<InboxPage>();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState('');
  const [form] = Form.useForm<{ kind: FeedbackKind; description: string; reference?: string }>();
  const submission = useRef<{ payload: string; id: string } | undefined>(undefined);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    const openFeedback = () => { setTab('feedback'); setSelected(''); setOpen(true); reload(); };
    window.addEventListener('shotloom-open-feedback', openFeedback);
    return () => window.removeEventListener('shotloom-open-feedback', openFeedback);
  }, [reload]);
  useEffect(() => {
    if (!cloudEnabled) return;
    const refreshVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('online', reload); document.removeEventListener('visibilitychange', refreshVisible); };
  }, [reload]);
  useEffect(() => {
    if (!cloudEnabled) return;
    let active = true;
    void cloudRequest<InboxPage>(`/notifications?offset=${(page - 1) * 20}&limit=20`).then(value => { if (active) { setInbox(value); setError(''); } })
      .catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [refresh, page]);
  if (!cloudEnabled) return null;
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); reload(); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const launch = (next: string) => { setTab(next); setSelected(''); setOpen(true); reload(); };
  return <>
    <div className="support-launcher"><Badge count={inbox?.unread || 0}><Button aria-label={t('support.notifications')} onClick={() => launch('notifications')} icon={<IconSymbol name="bell" />} /></Badge></div>
    <Modal open={open} title={t('support.title')} footer={null} onCancel={() => { if (!busy) setOpen(false); }} width={640} className="support-dialog">
      {error && <Alert type="error" title={error} action={<Button onClick={reload}>{t('support.refresh')}</Button>} />}
      {selected ? <FeedbackThread key={selected} id={selected} onBack={() => setSelected('')} onChanged={reload} /> : <Tabs activeKey={tab} onChange={value => { setTab(value); setSubmitted(''); }} items={[
        { key: 'feedback', label: t('support.submit'), children: <>
          {submitted && <Alert type="success" title={t('support.submitted')} description={<Button type="link" onClick={() => setSelected(submitted)}>{submitted}</Button>} />}
          <Form form={form} layout="vertical" initialValues={{ kind: 'feedback' }} onFinish={values => void run(async () => {
            const payload = JSON.stringify(values);
            if (submission.current?.payload !== payload) submission.current = { payload, id: crypto.randomUUID() };
            const result = await cloudRequest<Feedback>('/feedback', 'POST', { ...values, id: submission.current.id });
            setSubmitted(result.id); form.resetFields(); submission.current = undefined;
          })}>
            <Form.Item name="kind" label={t('support.kind')}><Select options={kindOptions()} disabled={busy} /></Form.Item>
            <Form.Item name="description" label={t('support.description')} rules={[{ required: true, whitespace: true, message: t('support.required') }]}><Input.TextArea maxLength={10000} autoSize={{ minRows: 5 }} disabled={busy} /></Form.Item>
            <Form.Item name="reference" label={t('support.reference')} extra={t('support.referenceHelp')}><Input maxLength={1000} disabled={busy} /></Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>{t('support.submit')}</Button>
          </Form>
        </> },
        { key: 'history', label: t('support.history'), children: <FeedbackList onSelect={setSelected} refresh={refresh} /> },
        { key: 'notifications', label: t('support.notifications'), children: <section className="support-list">
          <Space wrap><Button onClick={reload}>{t('support.refresh')}</Button><Button disabled={busy || !inbox?.unread} onClick={() => void run(async () => { await cloudRequest('/notifications/read-all', 'PUT', { asOf: inbox!.asOf }); })}>{t('support.readAll')}</Button></Space>
          {!inbox && !error && <Spin />}
          {inbox && !inbox.items.length && <Empty description={t('support.noNotifications')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          {inbox?.items.map(item => <article className="support-notification" key={item.id}>
            <button className="support-list-item" disabled={busy} onClick={() => void run(async () => {
              await cloudRequest(`/notifications/${item.id}/read`, 'PUT'); setSelected(item.feedback_id);
            })}><Space><Badge dot={!item.read_at} /><span>{t('support.replyReceived')}</span></Space><span className="support-excerpt">{item.body}</span><time>{date(item.created_at)}</time></button>
            {!item.read_at && <Button type="link" disabled={busy} onClick={() => void run(async () => { await cloudRequest(`/notifications/${item.id}/read`, 'PUT'); })}>{t('support.read')}</Button>}
          </article>)}
          <Pagination current={page} pageSize={20} total={inbox?.total || 0} onChange={setPage} showSizeChanger={false} hideOnSinglePage />
        </section> },
      ]} />}
    </Modal>
  </>;
}
