import { Slider } from 'antd';
import { useEffect, useRef } from 'react';
import { session } from '@/state/editor-session.ts';
import { NumberField } from './number-field.tsx';

interface SliderFieldProps {
    value: number;
    onInput: (value: number) => void;
    min: number;
    max: number;
    step: number;
    precision?: number;
    disabled?: boolean;
    /** Keep the numeric field unbounded when the slider range is only a convenience window. */
    unboundedInput?: boolean;
    'aria-label'?: string;
}

/**
 * Slider plus exact numeric readout for continuous parameters. The whole drag applies
 * live inside one history transaction, so undo steps over the entire gesture instead of
 * every intermediate value. The numeric field keeps its commit-on-blur behaviour.
 */
export function SliderField({
    value,
    onInput,
    min,
    max,
    step,
    precision,
    disabled,
    unboundedInput,
    ...rest
}: SliderFieldProps) {
    const dragging = useRef(false);
    // Leaving the panel mid-drag must not strand the open transaction.
    useEffect(
        () => () => {
            if (dragging.current) {
                dragging.current = false;
                session.endContinuousEdit();
            }
        },
        [],
    );
    const label = rest['aria-label'];
    return (
        <div className="slider-field">
            <Slider
                min={min}
                max={max}
                step={step}
                value={Math.min(max, Math.max(min, value))}
                disabled={disabled}
                ariaLabelForHandle={label}
                onChange={(next) => {
                    if (!dragging.current) dragging.current = session.beginContinuousEdit();
                    onInput(next);
                }}
                onChangeComplete={() => {
                    if (!dragging.current) return;
                    dragging.current = false;
                    session.endContinuousEdit();
                }}
            />
            <div className="slider-field__input">
                <NumberField
                    value={value}
                    min={unboundedInput ? undefined : min}
                    max={unboundedInput ? undefined : max}
                    step={step}
                    precision={precision}
                    disabled={disabled}
                    aria-label={label}
                    onCommit={onInput}
                />
            </div>
        </div>
    );
}