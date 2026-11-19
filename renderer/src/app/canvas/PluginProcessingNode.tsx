import { Button, Progress } from 'antd';
import type { WorkflowNodeRenderer } from './WorkflowCanvas';
import { cancelTask, findLatestTaskForNode, statusLabel, canRetryTask, recoverPluginProcessingTask } from '../../store/taskStore';
import { t } from '../../i18n';

export const PluginProcessingNode: WorkflowNodeRenderer = ({ node, actions }) => {
  const task = findLatestTaskForNode(node.id);
  return <div className="utility-node nodrag" onClick={() => actions.select(node.id)}>
    <div className="utility-head"><strong>{node.title}</strong><Button type="text" onClick={() => actions.delete(node.id)}>{t('ui.canvasAdapter.text.ff37dc39')}</Button></div>
    <div className="utility-body">
      <p>{(node.processingContract as any)?.pluginName}</p>
      <p>{statusLabel(task?.status || node.status)}</p>
      <Progress percent={Number(task?.progress || 0)} status={task?.status === 'completed' ? 'success' : task?.error ? 'exception' : 'normal'} />
      {task?.error && <p role="alert">{task.error}</p>}
      {task?.result?.archivedFiles?.length > 0 && <p>{t('pluginActions.resultsSaved')}</p>}
      {canRetryTask(task) && <Button onClick={() => recoverPluginProcessingTask(task!.id)}>{t('pluginActions.recover')}</Button>}
      {['queued', 'running'].includes(task?.status) && task?.requestPayload?.processingContract?.capability.supportsCancel &&
        <Button disabled={!task.remoteTaskId} onClick={() => cancelTask(task!.id)}>{t('plugins.cancel')}</Button>}
    </div>
  </div>;
};
