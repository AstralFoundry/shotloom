import { forwardRef, useImperativeHandle, useRef, useState, type ReactElement, type ReactNode, type RefAttributes } from "react";
import AntSelect, { type BaseOptionType, type DefaultOptionType, type RefSelectProps, type SelectProps as AntSelectProps } from "antd/es/select";

import { cn } from "@/host/cn";
import { useDismissPopupOnAnchorMove } from "@/host/hooks/use-dismiss-popup-on-anchor-move";

/**
 * 统一下拉选择：所有单选/多选都复用 Ant Design 的浮层与键盘行为，这里只负责
 * 尺寸别名、ariaLabel 兼容、统一 class 和「锚点移动时收起」。
 */

export type SelectSize = "sm" | "md";
export type SelectAppearance = "soft" | "pill" | "field";

export type SelectOption<V extends string | number = string> = DefaultOptionType & {
    value: V;
    label: ReactNode;
};

export type SelectProps<ValueType = unknown, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType> = Omit<AntSelectProps<ValueType, OptionType>, "size"> & {
    size?: SelectSize | "small" | "middle" | "large";
    ariaLabel?: string;
    appearance?: SelectAppearance;
};

type UnifiedSelect = (<ValueType = unknown, OptionType extends BaseOptionType | DefaultOptionType = DefaultOptionType>(props: SelectProps<ValueType, OptionType> & RefAttributes<RefSelectProps>) => ReactElement) & { displayName?: string };

const sizeMap = {
    sm: "small",
    md: "middle",
} as const;

export const Select = forwardRef<RefSelectProps, SelectProps>(function Select({ size, ariaLabel, appearance = "pill", className, variant, onMouseDown, onKeyDown, onFocus, onBlur, open, defaultOpen, onOpenChange, ...props }, ref) {
    const [inputModality, setInputModality] = useState<"unknown" | "pointer" | "keyboard">("unknown");
    const selectRef = useRef<RefSelectProps>(null);
    useImperativeHandle(ref, () => selectRef.current as RefSelectProps);
    const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false);
    const actualOpen = open ?? internalOpen;
    const changeOpen = (next: boolean) => {
        setInternalOpen(next);
        onOpenChange?.(next);
    };
    useDismissPopupOnAnchorMove(actualOpen, selectRef as unknown as { current: HTMLElement | null }, () => changeOpen(false));
    const normalizedSize = size && size in sizeMap ? sizeMap[size as keyof typeof sizeMap] : size;
    return (
        <AntSelect
            ref={selectRef}
            {...props}
            open={actualOpen}
            onOpenChange={changeOpen}
            variant={variant ?? "filled"}
            size={normalizedSize as AntSelectProps["size"]}
            aria-label={ariaLabel}
            className={cn("app-unified-select", `app-unified-select--${appearance}`, className)}
            data-input-modality={inputModality}
            onMouseDown={(event) => {
                setInputModality("pointer");
                onMouseDown?.(event);
            }}
            onKeyDown={(event) => {
                setInputModality("keyboard");
                onKeyDown?.(event);
            }}
            onFocus={(event) => {
                setInputModality((current) => (current === "unknown" ? "keyboard" : current));
                onFocus?.(event);
            }}
            onBlur={(event) => {
                setInputModality("unknown");
                onBlur?.(event);
            }}
        />
    );
}) as UnifiedSelect;

Select.displayName = "UnifiedSelect";
