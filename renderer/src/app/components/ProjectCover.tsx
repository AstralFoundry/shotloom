import { useEffect, useState } from 'react';
import { acquireMediaPreview, type CachedMediaLease } from '../../services/mediaPreviewCache';
import { IconSymbol } from './IconSymbol';

/** 使用现有的有界缩略图缓存，卡片卸载时归还图片租约。 */
export function ProjectCover({ source = '', revision = '', folder = false }: { source?: string; revision?: string; folder?: boolean }) {
  const [loaded, setLoaded] = useState({ source: '', url: '' });
  useEffect(() => {
    let active = true;
    let lease: CachedMediaLease | undefined;
    setLoaded({ source: '', url: '' });
    if (!source) return;
    if (/^(https?:|data:image\/|blob:)/i.test(source)) {
      setLoaded({ source, url: source });
      return;
    }
    void acquireMediaPreview({ path: source, kind: 'image', maxSize: 480, revision }).then(result => {
      lease = result;
      if (active) setLoaded({ source, url: result.url });
      else result.release();
    }).catch(() => { /* 丢失或不可读图片保留占位，不阻止打开工程。 */ });
    return () => { active = false; lease?.release(); };
  }, [source, revision]);
  const url = loaded.source === source ? loaded.url : '';
  return <span className={`project-cover-sheet${url ? ' has-image' : ''}`} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setLoaded({ source: '', url: '' })} /> : <IconSymbol name={folder ? 'folder' : 'grid'} />}
  </span>;
}
