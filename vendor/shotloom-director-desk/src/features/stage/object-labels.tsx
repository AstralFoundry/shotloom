import { FocusIcon, LightbulbIcon, CameraIcon, MessageCircleIcon, TagIcon, UserRoundIcon } from '@/shared/ui/icons.tsx';
import { requestHostAgentOpen } from '@/app/host-bridge.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useStageOverlayStore } from '@/state/stage-overlay-store.ts';

/**
 * Object name tags projected from the 3D scene; clicking one selects the entity.
 *
 * Which entities get a tag is decided by the `labelMode` preference in the engine's projection,
 * so this component only renders what it is handed. Icons differentiate the kinds because a
 * lighting rig and a prop used to look identical at a glance.
 */
export function ObjectLabels({
    onContextMenu,
}: {
    onContextMenu?: (id: string, event: React.MouseEvent<HTMLElement>) => void;
}) {
    const t = useTranslation();
    const labels = useStageOverlayStore((state) => state.labels);
    const selected = useStageOverlayStore((state) => state.selected);

    return (
        <div className="object-labels">
            {labels
                .filter((label) => label.visible)
                .map((label) => (
                    <div
                        key={label.id}
                        className={`object-label object-label--${label.light ? 'light' : label.kind} ${
                            label.id === selected ? 'is-selected' : ''
                        }`}
                        style={{ left: label.x, top: label.y }}
                        onContextMenu={(event) => onContextMenu?.(label.id, event)}
                    >
                        <button type="button" className="object-label__select"
                            onClick={() => session.selectEntity(label.id)}>
                            <i style={{ background: label.color }} />
                            <span className="object-label__icon" aria-hidden="true">
                                {label.light ? (
                                    <LightbulbIcon />
                                ) : label.kind === 'camera' ? (
                                    <CameraIcon />
                                ) : label.kind === 'actor' || label.kind === 'crowd' ? (
                                    <UserRoundIcon />
                                ) : (
                                    <TagIcon />
                                )}
                            </span>
                            <span>{label.name}</span>
                            {label.kind === 'camera' ? (
                                <FocusIcon className="object-label__tail" aria-hidden="true" />
                            ) : null}
                        </button>
                        {label.id === selected && window.parent !== window ? (
                            <button type="button" className="object-label__agent"
                                aria-label={`${t('发送给导演助手')}：${label.name}`}
                                title={t('发送给导演助手')}
                                onClick={() => requestHostAgentOpen(label.id)}>
                                <MessageCircleIcon aria-hidden="true" />
                            </button>
                        ) : null}
                    </div>
                ))}
        </div>
    );
}
