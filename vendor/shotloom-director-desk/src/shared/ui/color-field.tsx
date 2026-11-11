import { ColorPicker } from 'antd';

interface ColorFieldProps {
    value: string;
    onCommit: (value: string) => void;
    label?: string;
}

/** Colour swatch that commits once, on picker close. */
export function ColorField({ value, onCommit, label }: ColorFieldProps) {
    return (
        <ColorPicker
            value={value}
            size="small"
            onChangeComplete={(color) => onCommit(color.toHexString())}
            showText={false}
            aria-label={label}
        />
    );
}
