import { CloseOutlined, PictureOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { session } from '@/state/editor-session.ts';
import { setReferenceBackdrop, useReferenceBackdrop } from '@/state/reference-backdrop.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { notify } from '@/shared/ui/feedback.ts';

/**
 * The reference image the host attached to this scene.
 *
 * The desk has always rendered this backdrop but never showed it, so a stale panorama from an
 * earlier upstream node kept silently affecting the shot background with no way to notice or
 * remove it. Removing reports back to the host, which owns the canvas edge.
 */
export function ReferenceBackdropSection() {
    const t = useTranslation();
    const backdrop = useReferenceBackdrop();
    if (!backdrop) return null;

    const remove = () => {
        // The host owns the edge; dropping the local record would make the picture disappear
        // from this panel while still being rendered, so the removal request goes out first.
        const removed = session.requestBackdropRemoval(backdrop.edgeId);
        setReferenceBackdrop(null);
        notify(removed ? t('已移除参考背景') : t('已从画面移除参考背景'));
    };

    return (
        <div className="reference-backdrop">
            <div className="reference-backdrop__head">
                <span>{t('参考背景')}</span>
                <Tooltip title={t('移除参考背景')}>
                    <Button
                        size="small"
                        type="text"
                        icon={<CloseOutlined />}
                        aria-label={t('移除参考背景')}
                        onClick={remove}
                    />
                </Tooltip>
            </div>
            <div className="reference-backdrop__body">
                <img src={backdrop.url} alt="" />
                <div className="reference-backdrop__meta">
                    <strong title={backdrop.name}>{backdrop.name}</strong>
                    <small>
                        {backdrop.width} × {backdrop.height}
                    </small>
                    <small>{t('来自上游图片节点')}</small>
                </div>
            </div>
        </div>
    );
}

/** Placeholder used when the desk runs standalone and no host is connected. */
export function ReferenceBackdropEmpty() {
    const t = useTranslation();
    return (
        <p className="muted small">
            <PictureOutlined /> {t('从画布上游图片节点接入后，这里会显示参考背景。')}
        </p>
    );
}
