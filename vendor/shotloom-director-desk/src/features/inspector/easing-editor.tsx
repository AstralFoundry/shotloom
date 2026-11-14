import { EASINGS, eased, type Easing } from '@/core/animation/channels.ts';
import { Select } from 'antd';
import { NumberField } from '@/shared/ui/number-field.tsx';
import { useTranslation } from '@/shared/i18n/use-translation.ts';

/** The graph evaluates the same easing function as timeline sampling. */
export function EasingEditor({ value = 'linear', disabled, onChange }: { value?: Easing; disabled?: boolean; onChange: (value: Easing) => void }) {
    const t = useTranslation();
    const custom = typeof value === 'object';
    const points = custom ? value.bezier : [0.25, 0.1, 0.25, 1];
    const graph = Array.from({ length: 65 }, (_, i) => `${12 + i / 64 * 216},${108 - eased(i / 64, value) * 96}`).join(' ');
    return <div className="easing-editor">
        <Select size="small" aria-label={t('速度曲线')} disabled={disabled} value={custom ? 'bezier' : value} options={[...Object.entries(EASINGS).map(([value, label]) => ({ value, label: t(label) })), { value: 'bezier', label: t('自定义贝塞尔') }]} onChange={next => onChange(next === 'bezier' ? { bezier: [0.25, 0.1, 0.25, 1] } : next as Easing)} />
        <svg viewBox="0 0 240 120" role="img" aria-label={t('时间与进度曲线')} style={{ width: '100%', background: 'var(--ed-bg-panel)', borderRadius: 6 }}>
            <path d="M12 12V108H228 M12 108L228 12" fill="none" stroke="var(--ed-border)" />
            <polyline points={graph} fill="none" stroke="var(--ed-accent)" strokeWidth="2" />
            {custom && <><path d={`M12 108L${12 + points[0] * 216} ${108 - points[1] * 96} M228 12L${12 + points[2] * 216} ${108 - points[3] * 96}`} stroke="currentColor" opacity="0.4" />{[0, 2].map(i => <circle key={i} cx={12 + points[i] * 216} cy={108 - points[i + 1] * 96} r="5" fill="var(--ed-accent)" />)}</>}
        </svg>
        {custom && <div className="button-row">{points.map((v, i) => <label key={i}>{['X1','Y1','X2','Y2'][i]}<NumberField value={v} min={0} max={1} step={0.05} disabled={disabled} onCommit={next => { const copy = [...points] as [number,number,number,number]; copy[i] = next; onChange({ bezier: copy }); }} /></label>)}</div>}
    </div>;
}
