/**
 * 工作流管理页。
 *
 * 模板是应用级目录（跨项目复用），所以管理入口放在全局侧栏，而不是某个画布里。
 * 这里负责重命名、复制、导出与删除；「应用到画布」仍在画布底栏，需要当前节点上下文。
 */
import { t } from '@/i18n';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { App, Button, Empty, Input, List, Modal, Tag } from 'antd';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import {
  deleteWorkflowTemplate,
  duplicateWorkflowTemplate,
  loadWorkflowTemplates,
  renameWorkflowTemplate,
  workflowTemplateStore,
} from '@/store/workflowTemplateStore';
import { templateShareableCopy } from '@/services/workflowTemplateService';
import { desktopApi } from '@/services/desktopApi';
import { showErrorMessage, showToast } from '@/store/notificationStore';
import { ProjectScopeHeader } from '../components/ProjectScopeHeader';
import type { WorkflowTemplate } from '@/domain/workflow/types';

export function WorkflowsView() {
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const { modal } = App.useApp();
  const [keyword, setKeyword] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadWorkflowTemplates();
  }, []);

  const templates = useMemo(() => {
    const query = keyword.trim().toLocaleLowerCase();
    if (!query) return workflowTemplateStore.templates;
    return workflowTemplateStore.templates.filter((template) => (
      `${template.name} ${template.description}`.toLocaleLowerCase().includes(query)
    ));
  }, [keyword, workflowTemplateStore.templates.length, workflowTemplateStore.templates]);

  async function confirmRename() {
    if (!renaming) return;
    setBusy(true);
    try {
      const next = await renameWorkflowTemplate(renaming.id, renaming.name);
      if (next) showToast(t('workflows.renamed'), 'success');
      setRenaming(null);
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(template: WorkflowTemplate) {
    const copy = await duplicateWorkflowTemplate(template.id);
    if (copy) showToast(t('workflows.duplicated', { name: copy.name }), 'success');
  }

  async function exportTemplate(template: WorkflowTemplate) {
    try {
      const payload = templateShareableCopy(template);
      const result = await desktopApi.file.saveJson(`${template.name || 'workflow'}.workflow.json`, payload);
      if (result) showToast(t('workflows.exported', { name: result.fileName || result.path || template.name }), 'success');
    } catch (error) {
      showErrorMessage((error as Error)?.message || t('workflows.exportFailed'), t('workflows.exportFailed'));
    }
  }

  function confirmDelete(template: WorkflowTemplate) {
    modal.confirm({
      title: t('workflows.deleteConfirm', { name: template.name }),
      okText: t('workflows.delete'),
      cancelText: t('workflows.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteWorkflowTemplate(template.id);
      },
    });
  }

  return (
    <>
      <ProjectScopeHeader title={t('workflows.title')} description={t('workflows.subtitle')} showDescription flat>
        <label className="workflows-search">
          <Input.Search
            allowClear
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder={t('workflows.search')}
          />
        </label>
      </ProjectScopeHeader>
      <div className="scroll-area workflows-body">
        {!templates.length && <Empty description={t('workflows.empty')} />}
        <List
          dataSource={templates}
          renderItem={(template) => {
            const steps = template.definition.nodes.filter((node) => node.role === 'generation').length;
            const inputs = template.definition.nodes.filter((node) => node.role === 'input').length;
            return (
              <List.Item
                key={template.id}
                actions={[
                  <Button key="rename" size="small" onClick={() => setRenaming({ id: template.id, name: template.name })}>
                    {t('workflows.rename')}
                  </Button>,
                  <Button key="duplicate" size="small" onClick={() => void duplicate(template)}>
                    {t('workflows.duplicate')}
                  </Button>,
                  <Button key="export" size="small" onClick={() => void exportTemplate(template)}>
                    {t('workflows.export')}
                  </Button>,
                  <Button key="delete" size="small" danger onClick={() => confirmDelete(template)}>
                    {t('workflows.delete')}
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={<span>{template.name} <Tag>v{template.revision}</Tag></span>}
                  description={t('workflows.meta', { steps, inputs })}
                />
              </List.Item>
            );
          }}
        />
        <p className="workflows-hint">{t('workflows.applyHint')}</p>
      </div>
      <Modal
        title={t('workflows.renameTitle')}
        open={Boolean(renaming)}
        onCancel={() => setRenaming(null)}
        onOk={() => void confirmRename()}
        okText={t('workflows.rename')}
        cancelText={t('workflows.cancel')}
        confirmLoading={busy}
      >
        <Input
          value={renaming?.name || ''}
          onChange={(event) => setRenaming((current) => (current ? { ...current, name: event.target.value } : current))}
          aria-label={t('workflows.renameTitle')}
        />
      </Modal>
    </>
  );
}
