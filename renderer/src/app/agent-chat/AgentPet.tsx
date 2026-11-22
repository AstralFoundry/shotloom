import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { usePetHitArea } from './usePetHitArea';
import { t } from '@/i18n';
import type { AgentPetState } from '../../services/agentPetArchive';
import { getAgentPetLibrary, loadAgentPetLibrary, subscribeAgentPetLibrary, type AgentPet } from '../../services/agentPetLibrary';

export function useAgentPets() {
  const library = useSyncExternalStore(subscribeAgentPetLibrary, getAgentPetLibrary);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadAgentPetLibrary().catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);
  return { ...library, error };
}

function useMediaUrl(source: string | Blob) {
  const [resource, setResource] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (typeof source === 'string') return;
    const url = URL.createObjectURL(source);
    setResource({ blob: source, url });
    return () => URL.revokeObjectURL(url);
  }, [source]);
  return typeof source === 'string' ? source : resource?.blob === source ? resource.url : undefined;
}

export function AgentPetPoster({ pet }: { pet: AgentPet }) {
  return <img src={useMediaUrl(pet.poster)} alt="" draggable={false} />;
}

const labels = {
  idle: 'agentPet.idle', thinking: 'agentPet.thinking', working: 'agentPet.working', completed: 'agentPet.completed',
} as const;

function PetClip({ source, loop, paused, active, onFinish }: {
  source: string | Blob; loop: boolean; paused: boolean; active: boolean; onFinish: () => void;
}) {
  const url = useMediaUrl(source);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const clip = video.current;
    if (!clip || !url) return;
    if (!active) {
      clip.pause();
      if (clip.currentTime) clip.currentTime = 0;
      setPlaying(false);
    } else if (paused) clip.pause();
    else void clip.play().catch(() => {});
  }, [url, paused, active]);
  return url && !failed ? <video
    ref={video}
    className={active && playing ? 'is-playing' : undefined}
    src={url}
    muted
    playsInline
    preload="auto"
    loop={loop}
    onPlaying={() => setPlaying(true)}
    onEnded={active ? onFinish : undefined}
    onError={() => setFailed(true)}
    aria-hidden="true"
  /> : null;
}

const idleClips = ['idle', 'thinking', 'idle', 'working'] as const;
const idleLines = [
  'agentPet.line.direct', 'agentPet.line.safety', 'agentPet.line.cut',
  'agentPet.line.slate', 'agentPet.line.roll', 'agentPet.line.wrap',
  'agentPet.line.improvise', 'agentPet.line.sunset', 'agentPet.line.render',
  'agentPet.line.credits', 'agentPet.line.budget', 'agentPet.line.focus',
  'agentPet.line.delayCut', 'agentPet.line.fan', 'agentPet.line.water',
  'agentPet.line.outtakes', 'agentPet.line.afterCredits', 'agentPet.line.coffee',
] as const;
const POSITION_KEY = 'shotloom:agent-pet-position-v1';
interface Point { x: number; y: number }

function readPetPosition(): Point | undefined {
  try {
    const position = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
    if (position && [position.x, position.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) return position;
  } catch { /* An unavailable or invalid preference uses the default corner. */ }
  return undefined;
}

interface PetBounds {
  box: DOMRect;
  layer: DOMRect;
  leftBleed: number;
  rightBleed: number;
  topBleed: number;
}

function locationFor({ box, layer, leftBleed, rightBleed, topBleed }: PetBounds, dx: number, dy: number): Point {
  const fraction = (position: number, available: number) =>
    available > 0 ? Math.min(1, Math.max(0, position / available)) : 0;
  return {
    x: fraction(box.left - layer.left + dx + leftBleed, layer.width - box.width + leftBleed + rightBleed),
    y: fraction(box.top - layer.top + dy + topBleed, layer.height - box.height + topBleed),
  };
}

function getPetBounds(button: HTMLButtonElement) {
  const launcher = button.parentElement;
  const layer = launcher?.parentElement;
  if (!launcher || !layer) return undefined;
  const style = getComputedStyle(launcher);
  return {
    box: launcher.getBoundingClientRect(),
    layer: layer.getBoundingClientRect(),
    leftBleed: parseFloat(style.getPropertyValue('--agent-pet-left-bleed')) || 0,
    rightBleed: parseFloat(style.getPropertyValue('--agent-pet-right-bleed')) || 0,
    topBleed: parseFloat(style.getPropertyValue('--agent-pet-top-bleed')) || 0,
  };
}

export function AgentPetLauncher({ pet, phase, expanded, onToggle, onFinish, inset }: {
  pet: AgentPet; phase: AgentPetState; expanded: boolean; onToggle: (() => void) | undefined; onFinish: () => void; inset: number;
}) {
  const { media, hit } = usePetHitArea();
  const [position, setPosition] = useState(readPetPosition);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; start: Point; bounds: PetBounds; position?: Point } | undefined>(undefined);
  const suppressClick = useRef(false);
  const [idle, setIdle] = useState({ petId: pet.id, index: 0 });
  const idleIndex = pet.id === idle.petId ? idle.index : 0;
  const clip = phase === 'idle' ? idleClips[idleIndex] ?? 'idle' : phase;
  const [motion, setMotion] = useState(false);
  const [paused, setPaused] = useState(() => document.hidden);
  const [line, setLine] = useState(0);
  const hasAgent = Boolean(onToggle);
  const nextIdleIndex = (idleIndex + 1) % idleClips.length;
  const nextClip = idleClips[nextIdleIndex] ?? 'idle';
  const clips = !hasAgent && phase === 'idle' ? [clip, nextClip] : [clip];
  const caption = t(hasAgent ? labels[phase] : idleLines[line] ?? idleLines[0]);
  useEffect(() => {
    if (hasAgent || paused) return;
    const timer = window.setTimeout(() => setLine((line + 1) % idleLines.length), 7_000);
    return () => window.clearTimeout(timer);
  }, [hasAgent, paused, line]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => setMotion(!preference.matches);
    const syncVisibility = () => setPaused(document.hidden);
    syncMotion();
    syncVisibility();
    preference.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      preference.removeEventListener('change', syncMotion);
      document.removeEventListener('visibilitychange', syncVisibility);
    };
  }, []);
  useEffect(() => {
    if (phase !== 'idle') setIdle(current => current.index === 0 ? current : { petId: pet.id, index: 0 });
  }, [phase, pet.id]);

  useEffect(() => {
    if (phase !== 'completed') return;
    // A stalled clip or a static appearance must still leave the completed state.
    const timer = window.setTimeout(onFinish, motion && !paused ? 15_000 : 2_000);
    return () => window.clearTimeout(timer);
  }, [phase, motion, paused, onFinish]);

  function savePosition(next: Point) {
    setPosition(next);
    try { localStorage.setItem(POSITION_KEY, JSON.stringify(next)); }
    catch { /* Continue using the in-memory position. */ }
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    const bounds = getPetBounds(event.currentTarget);
    if (!bounds) return;
    event.preventDefault();
    suppressClick.current = false;
    drag.current = { bounds, id: event.pointerId, start: { x: event.clientX, y: event.clientY } };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.start.x;
    const dy = event.clientY - gesture.start.y;
    if (!gesture.position && Math.hypot(dx, dy) < 5) return;
    gesture.position = locationFor(gesture.bounds, dx, dy);
    suppressClick.current = true;
    setDragging(true);
    setPosition(gesture.position);
  }

  function finishDrag(event: PointerEvent<HTMLButtonElement>) {
    const gesture = drag.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    drag.current = undefined;
    setDragging(false);
    if (gesture.position) savePosition(gesture.position);
  }

  function moveWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const dx = event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0;
    const dy = event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0;
    if (!dx && !dy) return;
    const bounds = getPetBounds(event.currentTarget);
    if (!bounds) return;
    event.preventDefault();
    event.stopPropagation();
    savePosition(locationFor(bounds, dx, dy));
  }

  const style = {
    '--agent-pet-inset': `${inset}px`,
    ...(position && { '--agent-pet-x': position.x, '--agent-pet-y': position.y }),
  } as CSSProperties;

  return <div className="agent-pet-launcher" data-positioned={Boolean(position)} data-dragging={dragging} style={style}>
    <span ref={media} className="agent-pet-media" aria-hidden="true">
      <AgentPetPoster pet={pet} />
      {motion && clips.map(item => <PetClip key={`${pet.id}:${phase}:${item}`} source={pet.clips[item]} paused={paused}
        active={item === clip} loop={phase === 'thinking' || phase === 'working'}
        onFinish={phase === 'idle' ? () => setIdle({ petId: pet.id, index: nextIdleIndex }) : onFinish} />)}
    </span>
    <button type="button" className="agent-pet-trigger" aria-expanded={onToggle ? expanded : undefined}
      aria-label={t(onToggle ? expanded ? 'agentPet.closeAgent' : 'agentPet.openAgent' : 'agentPet.next', { name: pet.name })}
      title={onToggle ? t(labels[phase]) : t('agentPet.next', { name: pet.name })}
      aria-description={`${caption} · ${t('agentPet.moveHint')}`}
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag}
      onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onKeyDown={moveWithKeyboard}
      onClick={event => {
        const dragged = suppressClick.current && event.detail !== 0;
        suppressClick.current = false;
        if (dragged) return;
        if (onToggle) onToggle();
        else {
          setLine(index => (index + 1) % idleLines.length);
          setIdle({ petId: pet.id, index: nextIdleIndex });
        }
      }}>
      <span ref={hit} className="agent-pet-hit-area" aria-hidden="true" />
      <span className="agent-pet-caption" aria-hidden="true">
        {hasAgent && <span className="agent-pet-indicator" data-phase={phase} />}
        <span className="agent-pet-caption-text">{caption}</span>
      </span>
    </button>
  </div>;
}
