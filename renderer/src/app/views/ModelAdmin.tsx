import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Spin, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { IconSymbol } from '../components/IconSymbol';
import { SearchInput } from '../components/SearchInput';
import { cloudRequest } from '../../services/cloudRequest';
import { t } from '../../i18n';
import type { ModelPublication } from '../../../../shared/modelPublications';
import { AdminUsers } from './AdminUsers';

type Template = { id: string; name: string; type: string; provider: string };
type Audit = { id: number; actor_id: string; action: string; model_id: string | null; details: { user_id?: string }; created_at: string };
export function ModelAdmin() {
  const [models, setModels] = useState<ModelPublication[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ModelPublication | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [form] = Form.useForm<ModelPublication>();
  const selectedType = Form.useWatch('type', form);
  const selectedPublished = Form.useWatch('published', form);
  const typeOptions = ['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'].map(value => ({ value, label: t(`admin.models.${value}` as Parameters<typeof t>[0]) }));
  const reload = async () => {
    const [value, logs] = await Promise.all([
      cloudRequest<{ models: ModelPublication[]; templates: Template[] }>('/admin/models'),
      cloudRequest<Audit[]>('/admin/audit'),
    ]);
    setModels(value.models); setTemplates(value.templates); setAudit(logs);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const initialize = () => run(async () => {
    const me = await cloudRequest<{ userId: string }>('/admin/me');
    setCurrentUserId(me.userId); setAuthorized(true); await reload();
  });
  useEffect(() => { void initialize(); }, []);
  const edit = (row: ModelPublication) => { setError(''); setEditing(row); };
  const save = () => run(async () => {
    const values = await form.validateFields();
    await cloudRequest('/admin/models', 'PUT', { ...values, id: editing!.id, revision: editing!.revision });
    setEditing(null); await reload();
  });
  const cell = (label: string) => () => ({ className: 'admin-data-cell', 'data-label': label });
  const icons = ['text', 'image', 'film', 'waveform'];
  const filteredModels = models.filter(model => (!typeFilter || model.type === typeFilter)
    && [model.id, model.name, model.owned_by].some(value => value?.toLowerCase().includes(search.trim().toLowerCase())));
  return <main className="model-admin">
    <header className="model-admin-header">
      <div className="admin-brand"><span className="admin-brand-icon"><IconSymbol name="shield" /></span><div><strong>Shotloom</strong><span>{t('admin.title')}</span></div></div>
      <Button href="/" icon={<IconSymbol name="arrow-left" />}>{t('admin.models.back')}</Button>
    </header>
    <div className="admin-intro"><div><p className="admin-eyebrow">{t('admin.workspace')}</p>
      <Typography.Title level={1}>{t('admin.models.title')}</Typography.Title>
      <Typography.Paragraph>{t('admin.models.description')}</Typography.Paragraph>
    </div><Tag icon={<IconSymbol name="link" />}>New API</Tag></div>
    {error && <Alert type="error" showIcon title={error} action={<Button onClick={() => void initialize()} disabled={busy}>{t('admin.models.refresh')}</Button>} />}
    {!authorized && busy && <div className="admin-loading" role="status"><Spin /><span>{t('admin.loading')}</span></div>}
    {authorized && <>
      <section className="admin-summary" aria-label={t('admin.models.type')}>
        {typeOptions.map((option, index) => <div className="admin-stat" key={option.value}><span className="admin-stat-icon"><IconSymbol name={icons[index] || 'layers'} /></span><div><span>{option.label}</span><strong>{models.filter(model => model.type === option.value && model.available).length}</strong></div></div>)}
      </section>
      <section className="admin-panel">
      <Tabs items={[{ key: 'models', label: <span className="admin-tab"><IconSymbol name="layers" />{t('admin.models.list')}</span>, children: <>
        <div className="admin-section-header"><div><h2>{t('admin.models.list')}</h2><p>{t('admin.models.overview', { total: models.length, published: models.filter(model => model.available && model.published).length })}</p></div>
          <div className="model-admin-actions"><Button disabled={busy} icon={<IconSymbol name="refresh" />} onClick={() => void run(reload)}>{t('admin.models.refresh')}</Button>
          <Button type="primary" loading={busy} icon={<IconSymbol name="link" />} onClick={() => void run(async () => { await cloudRequest('/admin/models/sync', 'POST'); await reload(); })}>{t('admin.models.sync')}</Button></div></div>
        <Alert type="info" showIcon title={t('admin.models.syncNote')} />
        <div className="admin-filters"><div className="admin-search"><SearchInput value={search} onChange={setSearch} placeholder={t('admin.models.search')} /></div>
          <Select aria-label={t('admin.models.type')} placeholder={t('admin.models.allTypes')} allowClear value={typeFilter} onChange={setTypeFilter} options={typeOptions} /></div>
        <Table<ModelPublication> className="admin-table" rowKey="id" loading={busy} dataSource={filteredModels} pagination={{ defaultPageSize: 20, showSizeChanger: true }} columns={[
        { title: t('admin.models.id'), onCell: cell(t('admin.models.id')), render: (_, row) => <div className="admin-identity"><strong>{row.name || row.id}</strong><code>{row.id}</code></div> },
        { title: t('admin.models.owner'), dataIndex: 'owned_by', onCell: cell(t('admin.models.owner')) },
        { title: t('admin.models.type'), onCell: cell(t('admin.models.type')), render: (_, row) => typeOptions.find(option => option.value === row.type)?.label || t('admin.models.pending') },
        { title: t('admin.models.template'), dataIndex: 'template_id', onCell: cell(t('admin.models.template')), render: value => value || '—' },
        { title: t('admin.models.status'), onCell: cell(t('admin.models.status')), render: (_, row) => <Tag color={row.available && row.published ? 'green' : 'default'}>{!row.available ? t('admin.models.unavailable') : row.published ? t('admin.models.published') : t('admin.models.pending')}</Tag> },
        { title: t('admin.models.actions'), onCell: cell(t('admin.models.actions')), render: (_, row) => <Button disabled={busy} icon={<IconSymbol name="pencil" />} onClick={() => edit(row)}>{t('admin.models.edit')}</Button> },
      ]} /></> }, { key: 'users', label: <span className="admin-tab"><IconSymbol name="user" />{t('admin.users.title')}</span>, children: <AdminUsers currentUserId={currentUserId} onChanged={reload} onRevoked={() => {
        setAuthorized(false); setError(t('admin.users.revoked'));
      }} /> }, { key: 'audit', label: <span className="admin-tab"><IconSymbol name="clock" />{t('admin.models.audit')}</span>, children: <>
        <div className="admin-section-header"><div><h2>{t('admin.models.audit')}</h2><p>{t('admin.audit.description')}</p></div><Button disabled={busy} icon={<IconSymbol name="refresh" />} onClick={() => void run(reload)}>{t('admin.models.refresh')}</Button></div>
        <Table<Audit> className="admin-table" rowKey="id" dataSource={audit} pagination={{ defaultPageSize: 20 }} columns={[
        { title: t('admin.models.time'), onCell: cell(t('admin.models.time')), render: (_, row) => new Date(row.created_at).toLocaleString() },
        { title: t('admin.models.actor'), dataIndex: 'actor_id', onCell: cell(t('admin.models.actor')) },
        { title: t('admin.models.actions'), dataIndex: 'action', onCell: cell(t('admin.models.actions')) },
        { title: t('admin.audit.target'), onCell: cell(t('admin.audit.target')), render: (_, row) => row.model_id || row.details?.user_id || '—' },
      ]} /></> }]} />
      </section>
    </>}
    <Modal className="admin-model-modal" open={Boolean(editing)} title={editing?.id} onCancel={() => { if (!busy) setEditing(null); }} onOk={() => void save()} confirmLoading={busy} okText={t('admin.models.save')} cancelText={t('admin.models.cancel')} destroyOnHidden>
      {error && <Alert type="error" showIcon title={error} />}
      <Form key={editing?.id} form={form} layout="vertical" preserve={false} initialValues={editing ? { ...editing, name: editing.name || editing.id } : {}}>
        <Form.Item name="name" label={t('admin.models.name')} rules={[{ required: true }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="type" label={t('admin.models.type')} rules={[{ required: Boolean(selectedPublished) }]}><Select options={typeOptions} onChange={() => form.setFieldValue('template_id', null)} /></Form.Item>
        <Form.Item name="template_id" label={t('admin.models.template')} rules={[{ required: Boolean(selectedPublished) }]}><Select allowClear onChange={value => form.setFieldValue('template_id', value ?? null)} showSearch optionFilterProp="label" options={templates.filter(item => item.type === selectedType).map(item => ({ value: item.id, label: `${item.name} (${item.id})` }))} /></Form.Item>
        <Typography.Paragraph type="secondary">{t('admin.models.templateNote')}</Typography.Paragraph>
        <Form.Item name="sort_order" label={t('admin.models.sort')}><InputNumber min={-100000} max={100000} precision={0} /></Form.Item>
        <Form.Item name="published" label={t('admin.models.published')} valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Modal>
  </main>;
}
