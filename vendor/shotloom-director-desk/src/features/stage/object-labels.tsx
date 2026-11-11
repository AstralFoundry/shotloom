import { AimOutlined, BulbOutlined, CameraOutlined, TagOutlined, UserOutlined } from '@ant-design/icons';
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
    const labels = useStageOverlayStore((state) => state.labels);
    const selected = useStageOverlayStore((state) => state.selected);

    return (
        <div className="object-labels">
            {labels
                .filter((label) => label.visible)
                .map((label) => (
                    <button
                        type="button"
                        key={label.id}
                        className={`object-label object-label--${label.light ? 'light' : label.kind} ${
                            label.id === selected ? 'is-selected' : ''
                        }`}
                        style={{ left: label.x, top: label.y }}
                        onClick={() => session.selectEntity(label.id)}
                        onContextMenu={(event) => onContextMenu?.(label.id, event)}
                    >
                        <i style={{ background: label.color }} />
                        <span className="object-label__icon" aria-hidden="true">
                            {label.light ? (
                                <BulbOutlined />
                            ) : label.kind === 'camera' ? (
                                <CameraOutlined />
                            ) : label.kind === 'actor' || label.kind === 'crowd' ? (
                                <UserOutlined />
                            ) : (
                                <TagOutlined />
                            )}
                        </span>
                        <span>{label.name}</span>
                        {label.kind === 'camera' ? (
                            <AimOutlined className="object-label__tail" aria-hidden="true" />
                        ) : null}
                    </button>
                ))}
        </div>
    );
}
