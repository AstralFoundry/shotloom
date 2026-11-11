import { InputNumber } from 'antd';
import { useEffect, useState } from 'react';

interface NumberFieldProps {
    value: number;
    onCommit: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    precision?: number;
    'aria-label'?: string;
    title?: string;
}

/**
 * Numeric field that keeps a local draft while typing and commits one history entry on
 * blur or Enter. antd's InputNumber would otherwise fire a change per keystroke.
 */
export function NumberField({ value, onCommit, min, max, step, precision, ...rest }: NumberFieldProps) {
    const [draft, setDraft] = useState<number | null>(value);
    useEffect(() => setDraft(value), [value]);

    const commit = () => {
        if (draft === null || !Number.isFinite(draft)) {
            setDraft(value);
            return;
        }
        if (draft !== value) onCommit(draft);
    };

    return (
        <InputNumber
            size="small"
            controls={false}
            value={draft}
            min={min}
            max={max}
            step={step}
            precision={precision}
            onChange={(next) => setDraft(typeof next === 'number' ? next : null)}
            onBlur={commit}
            onPressEnter={commit}
            style={{ width: '100%' }}
            {...rest}
        />
    );
}
