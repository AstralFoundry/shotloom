import { useEffect, useState } from 'react';
import { Alert, Button, Popconfirm, Table, Tag } from 'antd';
import { IconSymbol } from '../components/IconSymbol';
import { SearchInput } from '../components/SearchInput';
import { cloudRequest } from '../../services/cloudRequest';
import { t } from '../../i18n';

type AdminUser = { id: string; sub: string; username: string | null; email: string | null;
  created_at: string; updated_at: string; is_admin: boolean };
export function AdminUsers({ currentUserId, onChanged, onRevoked }: {
  currentUserId: string; onChanged: () => Promise<void>; onRevoked: () => void;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({ page: 1, pageSize: 20, search: '' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), search: query.search });
    void cloudRequest<{ items: AdminUser[]; total: number }>(`/admin/users?${params}`).then(value => {
      if (active) { setUsers(value.items); setTotal(value.total); }
    }).catch(value => { if (active) { setUsers([]); setError(value instanceof Error ? value.message : String(value)); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);
  const changeAdmin = async (user: AdminUser) => {
    setBusy(true); setError('');
    try {
      await cloudRequest(`/admin/users/${encodeURIComponent(user.id)}/admin`, 'PUT', {
        is_admin: !user.is_admin, expected_admin: user.is_admin,
      });
      if (user.id === currentUserId && user.is_admin) { onRevoked(); return; }
      setQuery(current => ({ ...current }));
      await onChanged();
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); }
  };
  const cell = (label: string) => () => ({ className: 'admin-data-cell', 'data-label': label });
  return <section>
    <div className="admin-section-header"><div><h2>{t('admin.users.title')}</h2><p>{t('admin.users.description')}</p></div></div>
    {error && <Alert type="error" showIcon title={error} />}
    <form onSubmit={event => { event.preventDefault(); setQuery(current => ({ ...current, page: 1, search: search.trim() })); }}>
      <div className="admin-filters">
        <div className="admin-search"><SearchInput value={search} onChange={setSearch} placeholder={t('admin.users.searchPlaceholder')} /></div>
        <Button type="primary" htmlType="submit" disabled={busy}>{t('admin.users.search')}</Button>
        <Button disabled={busy} icon={<IconSymbol name="refresh" />} onClick={() => setQuery(current => ({ ...current }))}>{t('admin.models.refresh')}</Button>
      </div>
    </form>
    <Table<AdminUser> className="admin-table" rowKey="id" dataSource={users} loading={loading || busy}
      pagination={{ current: query.page, pageSize: query.pageSize, total, showSizeChanger: true,
        onChange: (page, pageSize) => setQuery(current => ({ ...current, page, pageSize })) }} columns={[
        { title: t('admin.users.username'), onCell: cell(t('admin.users.username')), render: (_, user) => <div className="admin-identity"><strong>{user.username || '—'}</strong><span>New API #{user.sub}</span></div> },
        { title: t('admin.users.email'), dataIndex: 'email', onCell: cell(t('admin.users.email')), render: value => value || '—' },
        { title: t('admin.users.role'), onCell: cell(t('admin.users.role')), render: (_, user) => <Tag color={user.is_admin ? 'purple' : 'default'}>{user.is_admin ? t('admin.users.administrator') : t('admin.users.member')}</Tag> },
        { title: t('admin.users.created'), onCell: cell(t('admin.users.created')), render: (_, user) => new Date(user.created_at).toLocaleString() },
        { title: t('admin.models.actions'), onCell: cell(t('admin.models.actions')), render: (_, user) => <Popconfirm
          title={user.is_admin ? t('admin.users.confirmRevoke') : t('admin.users.confirmGrant')}
          description={`${user.username || user.email || user.sub} (New API #${user.sub})`}
          okText={t('admin.users.confirm')} cancelText={t('admin.models.cancel')} onConfirm={() => changeAdmin(user)} disabled={busy || loading}>
          <Button danger={user.is_admin} disabled={busy || loading}>{user.is_admin ? t('admin.users.revoke') : t('admin.users.grant')}</Button>
        </Popconfirm> },
      ]} />
  </section>;
}
