/**
 * 工作流模板库：把画布选区存成模板、换素材应用、查看实例进度。
 *
 * 模板结构与执行都在领域层与服务层；这里只做选择、命名、绑定与进度展示。
 */
import { t, type MessageKey } from '@/i18n';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { App, Button, Drawer, Empty, Input, List, Modal, Progress, Select, Tag } from 'antd';
import { getDomainRevision, subscribeDomain } from '@/store/domainReactivity';
import { store } from '@/store/projectStore';
import { showToast, showErrorMessage } from '@/store/notificationStore';
import {
  loadWorkflowTemplates,
  saveWorkflowTemplate,
  deleteWorkflowTemplate,
  workflowTemplateStore,
} from '@/store/workflowTemplateStore';
import { buildWorkflowTemplate, workflowErrorMessage } from '@/services/workflowTemplateService';
import { captureNodePreview, previewSourceForNode } from '@/services/workflowPreviewService';
import { trimNodePreviews } from '@/domain/workflow/flow';
import {
  instantiateWorkflowTemplate,
  type WorkflowInstanceRecord,
} from '@/services/workflowInstanceService';
import {
  cancelWorkflowInstance,
  retryWorkflowInstance,
  runWorkflowInstance,
  workflowInstanceProgress,
} from '@/services/workflowRunService';
import type { WorkflowTemplate } from '@/domain/workflow/types';

type AnyRecord = Record<string, any>;

const STATUS_LABEL: Record<string, MessageKey> = {
  planned: 'workflow.status.planned',
  running: 'workflow.status.running',
  completed: 'workflow.status.completed',
  failed: 'workflow.status.failed',
  cancelled: 'workflow.status.cancelled',
};

export function WorkflowLibrary({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { modal } = App.useApp();
  useSyncExternalStore(subscribeDomain, getDomainRevision);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [applying, setApplying] = useState<WorkflowTemplate | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void loadWorkflowTemplates();
  }, [open]);

  const templates = workflowTemplateStore.templates;
  const instances = ((store.project as AnyRecord).workflowInstances || []) as WorkflowInstanceRecord[];
  const materials = ((store.project as AnyRecord).materials || []) as AnyRecord[];
  const selection = store.selectedNodeIds || [];

  const slots = useMemo(
    () => (applying ? applying.definition.nodes.filter((node) => node.role === 'input') : []),
    [applying],
  );
  const missingBindings = slots.filter((node) => !bindings[node.id]);

  function saveSelection() {
    if (!selection.length) {
      showToast(t('workflow.save.empty'));
      return;
    }
    setName(t('workflow.save.defaultName'));
    setNaming(true);
  }

  async function confirmSave() {
    try {
      setBusy(true);
      const template = buildWorkflowTemplate({
        name: name.trim() || t('workflow.save.defaultName'),
        nodes: (store.project.nodes || []) as unknown as Parameters<typeof buildWorkflowTemplate>[0]['nodes'],
        edges: (store.project.edges || []) as unknown as Parameters<typeof buildWorkflowTemplate>[0]['edges'],
        selection,
        tasks: ((store.project.tasks || []) as AnyRecord[]).map((task) => ({
          id: String(task.id),
          nodeId: String(task.nodeId),
          status: String(task.status),
          ...(task.completedAt ? { completedAt: String(task.completedAt) } : {}),
          ...(task.createdAt ? { createdAt: String(task.createdAt) } : {}),
        })),
      });
      // 保存时补一张轻量缩略图，管理页才能把流程画出来；失败不影响保存。
      const canvasNodes = ((store.project.nodes || []) as AnyRecord[]).filter((node) => selection.includes(String(node.id)));
      const materials = ((store.project.materials || []) as AnyRecord[]);
      const previews: Record<string, Awaited<ReturnType<typeof captureNodePreview>>> = {};
      for (const canvasNode of canvasNodes) {
        const definitionNode = template.definition.nodes.find((node) => node.id === canvasNode.id);
        if (!definitionNode) continue;
        const source = previewSourceForNode(canvasNode, materials);
        const kind = definitionNode.mediaType === 'video' ? 'video'
          : definitionNode.mediaType === 'audio' ? 'audio'
            : definitionNode.mediaType === 'text' ? 'text' : 'image';
        previews[canvasNode.id] = await captureNodePreview({ ...source, kind });
      }
      const defined = trimNodePreviews({
        ...template.definition,
        nodes: template.definition.nodes.map((node) => (
          previews[node.id] ? { ...node, preview: previews[node.id] } : node
        )),
      });
      await saveWorkflowTemplate({ ...template, definition: defined });
      setNaming(false);
      showToast(t('workflow.save.done', { name: template.name }), 'success');
    } catch (error) {
      showErrorMessage(workflowErrorMessage(error), t('workflow.save.failed'));
    } finally {
      setBusy(false);
    }
  }

  function startApply(template: WorkflowTemplate) {
    const defaults: Record<string, string> = {};
    const projectMaterialIds = new Set(materials.map((material) => String(material.id)));
    for (const node of template.definition.nodes) {
      // 模板来自其他项目时，旧素材 id 在本项目里不存在，不能当作默认值。
      if (node.role === 'input' && node.resourceId && projectMaterialIds.has(String(node.resourceId))) {
        defaults[node.id] = String(node.resourceId);
      }
    }
    setBindings(defaults);
    setApplying(template);
  }

  async function applyTemplate(mode: 'apply' | 'apply-run') {
    if (!applying) return;
    try {
      setBusy(true);
      const { instance } = instantiateWorkflowTemplate(applying, { bindings });
      setApplying(null);
      if (mode === 'apply-run') {
        showToast(t('workflow.apply.running'), 'success');
        void runWorkflowInstance(instance.id);
      } else {
        showToast(t('workflow.apply.done'), 'success');
      }
    } catch (error) {
      showErrorMessage(t('workflow.apply.failed', { reason: workflowErrorMessage(error) }), t('workflow.apply.failedTitle'));
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
      width={640}
      zIndex={520}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      <div className="workflow-library">
        <div className="workflow-library-actions">
          <Button onClick={saveSelection} disabled={!selection.length}>
            {t('workflow.save.action', { count: selection.length })}
          </Button>
          <small>{t('workflow.save.hint')}</small>
        </div>

        {!templates.length && <Empty description={t('workflow.empty')} />}
        <List
          dataSource={templates}
          renderItem={(template) => (
            <List.Item
              actions={[
                <Button key="apply" size="small" onClick={() => startApply(template)}>
                  {t('workflow.apply.action')}
                </Button>,
                <Button key="delete" size="small" danger onClick={() => confirmDelete(template)}>
                  {t('workflow.delete.action')}
                </Button>,
              ]}
            >
              <List.Item.Meta
                title={<span>{template.name} <Tag>v{template.revision}</Tag></span>}
                description={t('workflow.meta', {
                  steps: template.definition.nodes.filter((node) => node.role === 'generation').length,
                  inputs: template.definition.nodes.filter((node) => node.role === 'input').length,
                })}
              />
            </List.Item>
          )}
        />

        {!!instances.length && (
          <>
            <h4>{t('workflow.instances.title')}</h4>
            <List
              size="small"
              dataSource={[...instances].reverse()}
              renderItem={(instance) => {
                const progress = workflowInstanceProgress(instance);
                const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : 0;
                return (
                  <List.Item
                    actions={[
                      instance.status === 'failed' || instance.status === 'cancelled' ? (
                        <Button key="retry" size="small" onClick={() => void retryWorkflowInstance(instance.id)}>
                          {t('workflow.instance.retry')}
                        </Button>
                      ) : null,
                      instance.status === 'running' ? (
                        <Button key="cancel" size="small" danger onClick={() => cancelWorkflowInstance(instance.id)}>
                          {t('workflow.instance.cancel')}
                        </Button>
                      ) : null,
                      instance.status === 'planned' ? (
                        <Button key="run" size="small" type="primary" onClick={() => void runWorkflowInstance(instance.id)}>
                          {t('workflow.instance.run')}
                        </Button>
                      ) : null,
                    ].filter(Boolean)}
                  >
                    <div style={{ width: '100%' }}>
                      <div className="workflow-instance-head">
                        <span>{instance.templateId}</span>
                        <Tag>{t(STATUS_LABEL[instance.status] || 'workflow.status.planned')}</Tag>
                      </div>
                      <Progress percent={percent} size="small" />
                    </div>
                  </List.Item>
                );
              }}
            />
          </>
        )}
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

      <Modal
        title={t('workflow.bind.title')}
        open={Boolean(applying)}
        onCancel={() => setApplying(null)}
        footer={[
          <Button key="cancel" onClick={() => setApplying(null)}>{t('workflow.cancel')}</Button>,
          <Button key="apply" disabled={missingBindings.length > 0} onClick={() => void applyTemplate('apply')} loading={busy}>
            {t('workflow.apply.action')}
          </Button>,
          <Button key="run" type="primary" disabled={missingBindings.length > 0} onClick={() => void applyTemplate('apply-run')} loading={busy}>
            {t('workflow.apply.run')}
          </Button>,
        ]}
      >
        {!slots.length && <p>{t('workflow.bind.none')}</p>}
        {missingBindings.length > 0 && (
          <p>{t('workflow.bind.missing', { count: missingBindings.length })}</p>
        )}
        {slots.map((node) => (
          <div key={node.id} className="workflow-bind-row">
            <span>{node.title}</span>
            <Select
              style={{ minWidth: 220 }}
              value={bindings[node.id]}
              placeholder={t('workflow.bind.placeholder')}
              onChange={(value?: string) => {
                if (!value) return;
                setBindings((current) => ({ ...current, [node.id]: value }));
              }}
              options={materials
                .filter((material) => !node.mediaType || String(material.resourceType || '').includes(node.mediaType) || !material.resourceType)
                .map((material) => ({ value: String(material.id), label: String(material.name || material.id) }))}
            />
          </div>
        ))}
      </Modal>
    </Drawer>
  );
}
