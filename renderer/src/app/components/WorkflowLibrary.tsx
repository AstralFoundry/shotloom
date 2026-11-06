/**
 * 画布上的工作流入口：保存当前选区为快照，或把已有模板整段导入当前画布。
 *
 * 导入会复制节点、连线与素材文件；不自动运行，也不需要再绑定素材。
 */
import { t } from '@/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { App, Button, Drawer, Input, List, Modal, Tag } from 'antd';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store } from '@/store/projectStore';
import { showErrorMessage, showToast } from '@/store/notificationStore';
import {
  deleteWorkflowTemplate,
  loadWorkflowTemplates,
  saveWorkflowTemplate,
  workflowTemplateStore,
} from '@/store/workflowTemplateStore';
import { buildWorkflowTemplate, workflowErrorMessage } from '@/services/workflowTemplateService';
import { captureNodePreview, previewSourceForNode } from '@/services/workflowPreviewService';
import { cloneWorkflowTemplate } from '@/services/workflowCloneService';
import { WorkflowMiniPreview } from './WorkflowMiniPreview';
import type { WorkflowTemplate } from '@/domain/workflow/snapshot';

type AnyRecord = Record<string, any>;

export function WorkflowLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { modal } = App.useApp();
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void loadWorkflowTemplates();
  }, [open]);

  const templates = workflowTemplateStore.templates;
  const selection = store.selectedNodeIds || [];

  async function confirmSave() {
    try {
      setBusy(true);
      const canvasNodes = ((store.project.nodes || []) as AnyRecord[]).filter((node) => selection.includes(String(node.id)));
      const materials = ((store.project.materials || []) as AnyRecord[]);
      const previews: Record<string, Awaited<ReturnType<typeof captureNodePreview>>> = {};
      for (const canvasNode of canvasNodes) {
        const source = previewSourceForNode(canvasNode, materials);
        previews[String(canvasNode.id)] = await captureNodePreview(source);
      }
      const template = buildWorkflowTemplate({
        name: name.trim() || t('workflow.save.defaultName'),
        nodes: (store.project.nodes || []) as AnyRecord[],
        edges: (store.project.edges || []) as AnyRecord[],
        selection,
        materials,
        previews,
      });
      await saveWorkflowTemplate(template);
      setNaming(false);
      showToast(t('workflow.save.done', { name: template.name }), 'success');
    } catch (error) {
      showErrorMessage(workflowErrorMessage(error), t('workflow.save.failed'));
    } finally {
      setBusy(false);
    }
  }

  async function importTemplate(template: WorkflowTemplate) {
    try {
      setBusy(true);
      const result = await cloneWorkflowTemplate(template);
      showToast(t('workflow.import.done', { nodes: result.nodeIds.length, materials: result.materialCount }), 'success');
      if (result.missingFiles) showErrorMessage(t('workflow.import.missing', { count: result.missingFiles }), t('workflow.import.failedTitle'));
    } catch (error) {
      showErrorMessage(workflowErrorMessage(error), t('workflow.import.failedTitle'));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(template: WorkflowTemplate) {
    modal.confirm({
      title: t('workflow.delete.confirm', { name: template.name }),
      okText: t('workflow.delete.action'),
      cancelText: t('workflow.cancel'),
      onOk: async () => {
        await deleteWorkflowTemplate(template.id);
      },
    });
  }

  return (
    <Drawer
      title={t('workflow.title')}
      placement="right"
      width={680}
      zIndex={520}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <div className="workflow-library">
        <div className="workflow-library-actions">
          <Button disabled={!selection.length} onClick={() => { setName(t('workflow.save.defaultName')); setNaming(true); }}>
            {t('workflow.save.action', { count: selection.length })}
          </Button>
          <small>{t('workflow.save.hint')}</small>
        </div>

        {!templates.length && <p>{t('workflow.empty')}</p>}
        <List
          dataSource={templates}
          renderItem={(template) => (
            <List.Item
              key={template.id}
              actions={[
                <Button key="import" size="small" type="primary" loading={busy} onClick={() => void importTemplate(template)}>
                  {t('workflow.apply.action')}
                </Button>,
                <Button key="delete" size="small" danger onClick={() => confirmDelete(template)}>
                  {t('workflow.delete.action')}
                </Button>,
              ]}
            >
              <div className="workflow-entry">
                <List.Item.Meta
                  title={<span>{template.name} <Tag>v{template.revision}</Tag></span>}
                  description={t('workflow.meta', {
                    steps: template.nodes.filter((node) => !['resource'].includes(String(node.type))).length,
                    inputs: template.materials.length,
                  })}
                />
                <WorkflowMiniPreview nodes={template.nodes} edges={template.edges} width={280} height={140} />
              </div>
            </List.Item>
          )}
        />
      </div>

      <Modal
        title={t('workflow.save.title')}
        open={naming}
        onCancel={() => setNaming(false)}
        onOk={() => void confirmSave()}
        okText={t('workflow.save.confirm')}
        cancelText={t('workflow.cancel')}
        confirmLoading={busy}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('workflow.save.defaultName')}
          aria-label={t('workflow.save.title')}
        />
      </Modal>
    </Drawer>
  );
}
