import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWorkbenchSurfaceRoot } from '../layout/workbenchSurface';
import type { AgentPetState } from '../../services/agentPetArchive';
import { AgentPetLauncher, useAgentPets } from './AgentPet';

const surfaceOrder = { canvas: 0, editor: 1, director: 2, media: 3 };
type Surface = keyof typeof surfaceOrder;
interface PetControls {
  expanded?: boolean;
  onToggle?: () => void;
  inset?: number;
}
interface Registration extends PetControls {
  surface: Surface;
  phase: AgentPetState;
  finish: () => void;
}

const PetWorkspaceContext = createContext<((registration: Registration) => () => void) | null>(null);
const noAction = () => {};

export function AgentPetWorkspace({ children }: { children: ReactNode }) {
  const surface = useWorkbenchSurfaceRoot();
  const { pets, selected, visible } = useAgentPets();
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const register = useCallback((registration: Registration) => {
    setRegistrations(current => [...current, registration]);
    return () => setRegistrations(current => current.filter(item => item !== registration));
  }, []);
  const target = registrations.reduce<Registration | undefined>((active, candidate) =>
    !active || surfaceOrder[candidate.surface] >= surfaceOrder[active.surface] ? candidate : active, undefined);
  const pet = visible ? pets.find(item => item.id === selected) : undefined;

  return <PetWorkspaceContext.Provider value={register}>
    {children}
    {pet && surface && createPortal(<div className="agent-pet-layer">
      <AgentPetLauncher pet={pet} phase={target?.onToggle ? target.phase : 'idle'} expanded={target?.expanded ?? false}
        onToggle={target?.onToggle} onFinish={target?.finish ?? noAction} inset={target?.inset ?? 0} />
    </div>, surface)}
  </PetWorkspaceContext.Provider>;
}

export function useAgentPetSurface(surface: Surface, enabled: boolean, { expanded, onToggle, inset }: PetControls = {}) {
  const register = useContext(PetWorkspaceContext);
  const [phase, setPhase] = useState<AgentPetState>('idle');
  const finish = useCallback(() => setPhase(current => current === 'completed' ? 'idle' : current), []);
  useLayoutEffect(() => {
    if (!register || !enabled) return;
    return register({ surface, phase, finish, ...(expanded !== undefined && { expanded }),
      ...(onToggle && { onToggle }), ...(inset !== undefined && { inset }) });
  }, [register, surface, enabled, expanded, onToggle, inset, phase, finish]);
  return setPhase;
}
