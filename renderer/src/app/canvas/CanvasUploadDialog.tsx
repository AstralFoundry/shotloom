import { useRef, useState } from 'react';
import { Button, Modal, Upload } from 'antd';
import { AudioLines, CloudUpload, FileText, Film, Image, X } from 'lucide-react';
import { t } from '@/i18n';
import { formatSize } from '../../utils/format';
import { inferMediaType } from '../../utils/mediaType';
import './CanvasUploadDialog.css';

export type CanvasUploadEntry = { file: File; index: number };
export type CanvasUploadFailure = { file: File; error: string };

export function CanvasUploadDialog({ initialFiles, onClose, onConfirm }: {
  initialFiles: File[];
  onClose: () => void;
  onConfirm: (entries: CanvasUploadEntry[]) => Promise<CanvasUploadFailure[]>;
}) {
  const [files, setFiles] = useState(() => initialFiles.filter(file => inferMediaType({ name: file.name, type: file.type }) !== 'file'));
  const [unsupported, setUnsupported] = useState(() => files.length !== initialFiles.length);
  const [failures, setFailures] = useState<CanvasUploadFailure[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const processing = useRef(false);
  const positions = useRef(new Map<File, number>());
  const nextPosition = useRef(0);

  function enqueue(batch: File[]) {
    const supported = batch.filter(file => inferMediaType({ name: file.name, type: file.type }) !== 'file');
    setUnsupported(supported.length !== batch.length);
    setFiles(current => [...current, ...supported]);
  }

  async function confirm() {
    if (processing.current || !files.length) return;
    processing.current = true;
    setBusy(true);
    setError('');
    try {
      const entries = files.map(file => {
        let index = positions.current.get(file);
        if (index === undefined) {
          index = nextPosition.current++;
          positions.current.set(file, index);
        }
        return { file, index };
      });
      const rejected = await onConfirm(entries);
      if (!rejected.length) onClose();
      else {
        setFailures(rejected);
        setFiles(rejected.map(item => item.file));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      processing.current = false;
      setBusy(false);
    }
  }

  return <Modal open centered width={720} className="canvas-upload-dialog" closable={!busy} keyboard={!busy}
    mask={{ closable: !busy }} onCancel={() => { if (!processing.current) onClose(); }}
    title={<div className="canvas-upload-heading">
      <div>{t('canvas.insert.uploadTitle')}<small>{t('canvas.insert.uploadDescription')}</small></div>
      <span>{t('canvas.insert.fileCount', { count: files.length })}</span>
    </div>}
    footer={<div className="canvas-upload-footer">
      <span>{t('canvas.insert.confirmHint')}</span>
      <Button disabled={busy} onClick={onClose}>{t('imageRecipe.common.cancel')}</Button>
      <Button type="primary" icon={<CloudUpload />} disabled={!files.length} loading={busy} onClick={() => void confirm()}>
        {t('canvas.insert.addToCanvas')}
      </Button>
    </div>}>
    <Upload.Dragger multiple disabled={busy} showUploadList={false}
      beforeUpload={(file, batch) => {
        if (!processing.current && file === batch[0]) enqueue(batch);
        return Upload.LIST_IGNORE;
      }}>
      <span className="canvas-upload-drop-content">
        <span className="canvas-upload-drop-icon" aria-hidden="true"><CloudUpload /></span>
        <strong>{t('canvas.insert.dropHint')}</strong>
        <span className="canvas-upload-drop-hint">{t('canvas.insert.multipleHint')}</span>
        <span className="canvas-upload-types">
          <span><Image aria-hidden="true" />{t('canvas.assetView.image')}</span>
          <span><Film aria-hidden="true" />{t('canvas.assetView.video')}</span>
          <span><AudioLines aria-hidden="true" />{t('canvas.assetView.audio')}</span>
          <span><FileText aria-hidden="true" />TXT / Markdown</span>
        </span>
      </span>
    </Upload.Dragger>
    {unsupported && <p className="canvas-upload-error" role="status">{t('canvas.assetView.unsupportedFiles')}</p>}
    {error && <p className="canvas-upload-error" role="alert">{error}</p>}
    {!!files.length && <ul className="canvas-upload-queue">
      {files.map((file, index) => <li key={index}>
        <FileText aria-hidden="true" />
        <span><strong title={file.name}>{file.name}</strong><small>{formatSize(file.size)}</small>
          {failures.find(item => item.file === file)?.error && <small className="canvas-upload-error">{failures.find(item => item.file === file)?.error}</small>}
        </span>
        <Button type="text" disabled={busy} aria-label={t('canvas.insert.removeFile', { name: file.name })} icon={<X />}
          onClick={() => setFiles(current => current.filter(item => item !== file))} />
      </li>)}
    </ul>}
  </Modal>;
}
