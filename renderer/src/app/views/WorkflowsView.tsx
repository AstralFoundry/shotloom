/**
 * 工作流管理页：模板是整段制作流程快照。
 *
 * 这里负责搜索、重命名、复制、导出、删除，以及「导入到当前画布」（需要已打开项目）。
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
import { templateShareableCopy, workflowDisplayOrder, workflowErrorMessage } from '@/services/workflowTemplateService';
import { cloneWorkflowTemplate } from '@/services/workflowCloneService';
import { desktopApi } from '@/services/desktopApi';
import { hasOpenProject } from '@/store/projectStore';
import { showErrorMessage, showToast } from '@/store/notificationStore';
import { ProjectScopeHeader } from '../components/ProjectScopeHeader';
import type { WorkflowNodePreview } from '@/domain/workflow/types';
import type { WorkflowSnapshotNode, WorkflowTemplate } from '@/domain/workflow/snapshot';

function StageThumb({ preview }: { preview?: WorkflowNodePreview | undefined }) {
  if (preview?.dataUrl) return <img className="workflow-flow-thumb" src={preview.dataUrl} alt="" />;
  const glyph = preview?.kind === 'video' ? '▶' : preview?.kind === 'audio' ? '♫' : preview?.kind === 'text' ? 'T' : '▧';
  return <span className="workflow-flow-thumb workflow-flow-thumb--empty">{glyph}</span>;
}

function roleLabel(node: WorkflowSnapshotNode): string {
  if (node.type === 'resource' || node.type === 'canvasSection') return t('workflows.role.media');
  if (node.type === 'textGeneration') return t('workflows.role.text');
  return t('workflows.role.generation');
}

function WorkflowFlowStrip({ template }: { template: WorkflowTemplate }) {
  const nodes = workflowDisplayOrder(template.nodes).slice(0, 8);
  if (!nodes.length) return null;
  return (
    <div className="workflow-flow" role="list" aria-label={t('workflows.flow')}>
      {nodes.map((node, index) => (
        <span className="workflow-flow-item" role="listitem" key={node.id}>
          {index > 0 && <span className="workflow-flow-arrow" aria-hidden="true">→</span>}
          <span className="workflow-flow-card">
            <StageThumb preview={node.preview} />
            <span className="workflow-flow-label">{node.preview?.label || node.title || node.id}</span>
            <span className="workflow-flow-role">{roleLabel(node)}</span>
          </span>
        </span>
      ))}
      {template.nodes.length > nodes.length && (
        <span className="workflow-flow-more">+{template.nodes.length - nodes.length}</span>
      )}
    </div>
  );
}

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

  async function importTemplate(template: WorkflowTemplate) {
    if (!hasOpenProject()) {
      showErrorMessage(t('workflow.import.noProject'), t('workflow.import.failedTitle'));
      return;
    }
    try {
      setBusy(true);
      const result = await cloneWorkflowTemplate(template);
      showToast(t('workflow.import.done', { nodes: result.nodeIds.length, materials: result.materialCount }), 'success');
    } catch (error) {
      showErrorMessage(workflowErrorMessage(error), t('workflow.import.failedTitle'));
    } finally {
      setBusy(false);
    }
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
        {workflowTemplateStore.error.startsWith('invalid-templates:') && (
          <p className="workflows-hint">
            {t('workflows.legacyNotice', { count: Number(workflowTemplateStore.error.split(':')[1]) || 0 })}
          </p>
        )}
        {!templates.length && <Empty description={t('workflows.empty')} />}
        <List
          dataSource={templates}
          renderItem={(template) => (
            <List.Item
              key={template.id}
              actions={[
                <Button key="import" size="small" type="primary" loading={busy} onClick={() => void importTemplate(template)}>
                  {t('workflow.apply.action')}
                </Button>,
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
              <div className="workflow-entry">
                <List.Item.Meta
                  title={<span>{template.name} <Tag>v{template.revision}</Tag></span>}
                  description={t('workflows.meta', { steps: template.nodes.length, inputs: template.materials.length })}
                />
                <WorkflowFlowStrip template={template} />
              </div>
            </List.Item>
          )}
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
