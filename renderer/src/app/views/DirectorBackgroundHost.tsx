import { useEffect, useState, useSyncExternalStore } from 'react';
import { store } from '../../store/projectStore';
import { subscribeDomain, getDomainRevision } from '../../store/domainReactivity';
import { directorDeskFrameSrc, directorDeskWorkspaceSrc } from '../adapters/directorDeskBridge';
import { directorDeskHasVisibleFrame, directorFramesRevision, registerDirectorDeskLauncher, subscribeDirectorFrames } from '../../services/directorDeskAgentRuntime';
import { DirectorWorkspace } from './DirectorWorkspace';

/** Keep delegated scenes available without changing navigation or mounting a chat pane. */
export function DirectorBackgroundHost() {
  const [requested, setRequested] = useState<string[]>([]);
  useSyncExternalStore(subscribeDirectorFrames, directorFramesRevision, directorFramesRevision);
  useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  useEffect(() => registerDirectorDeskLauncher(nodeId => {
    const target = nodeId || '';
    setRequested(current => current.includes(target) ? current : [...current, target]);
  }), []);
  return <div className="director-background-host" aria-hidden="true" inert>
    {requested.filter(nodeId => !directorDeskHasVisibleFrame(nodeId)
      && (!nodeId || store.project.nodes.some((node: { id: string; type: string; archived?: boolean }) => node.id === nodeId && node.type === 'threeDDirector' && !node.archived)))
      .map(nodeId => <DirectorWorkspace key={nodeId} nodeId={nodeId || undefined} background src={(instanceId, theme = 'light') => (nodeId ? directorDeskFrameSrc : directorDeskWorkspaceSrc)(instanceId, theme)} />)}
  </div>;
}
