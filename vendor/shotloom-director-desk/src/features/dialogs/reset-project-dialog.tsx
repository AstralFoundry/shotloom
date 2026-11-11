import { Button, Modal } from 'antd';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';

/** Reset the current director desk document after an explicit confirmation. */
export function ResetProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslation();
    return (
        <Modal
            open={open}
            title={t('重置项目')}
            onCancel={onClose}
            width={480}
            footer={
                <>
                    <Button onClick={onClose}>{t('取消')}</Button>
                    <Button type="primary" danger onClick={() => { if (session.resetProject()) onClose(); }}>
                        {t('重置项目')}
                    </Button>
                </>
            }
        >
            <p>{t('将清空当前导演台的所有场景和编辑内容，并恢复默认场景。重置后可立即撤销。')}</p>
        </Modal>
    );
}
