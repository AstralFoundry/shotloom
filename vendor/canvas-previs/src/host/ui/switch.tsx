import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/host/cn";

/**
 * Switch — 开关（button role=switch，无额外插层依赖）。
 *
 * 开 = 前景色轨道 + 反色滑块，关 = 浅灰轨道 + 描边；键盘沿用 button 的 Space/Enter。
 * API 对齐 AntD Switch：checked/defaultChecked/onChange(checked)/disabled/size。
 */

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "size" | "onChange"> {
    size?: "sm" | "md";
    checked?: boolean;
    defaultChecked?: boolean;
    loading?: boolean;
    checkedChildren?: ReactNode;
    unCheckedChildren?: ReactNode;
    onChange?: (checked: boolean) => void;
}

const SWITCH_SIZE: Record<"sm" | "md", { root: string; thumb: string; offset: string }> = {
    sm: { root: "h-5 w-8", thumb: "size-4", offset: "data-[state=on]:translate-x-3" },
    md: { root: "h-6 w-11", thumb: "size-5", offset: "data-[state=on]:translate-x-5" },
};

export function Switch({ size = "md", checked: checkedProp, defaultChecked = false, loading = false, checkedChildren, unCheckedChildren, onChange, disabled, className, "aria-label": ariaLabel, ...props }: SwitchProps) {
    const [innerChecked, setInnerChecked] = useState(defaultChecked);
    const controlled = checkedProp !== undefined;
    const checked = controlled ? checkedProp : innerChecked;
    const geometry = SWITCH_SIZE[size];

    return (
        <button
            type="button"
            role="switch"
            data-slot="switch"
            data-state={checked ? "on" : "off"}
            aria-checked={checked}
            aria-label={ariaLabel}
            aria-busy={loading || undefined}
            disabled={disabled}
            onClick={() => {
                if (disabled || loading) return;
                const next = !checked;
                if (!controlled) setInnerChecked(next);
                onChange?.(next);
            }}
            className={cn("pv-switch group/switch relative inline-flex shrink-0 select-none items-center rounded-full align-middle transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45", geometry.root, className)}
            {...props}
        >
            {unCheckedChildren !== undefined ? <span aria-hidden="true" className={cn("absolute right-1.5 text-[10px] leading-none font-medium", checked ? "opacity-0" : "opacity-100")}>{unCheckedChildren}</span> : null}
            {checkedChildren !== undefined ? <span aria-hidden="true" className={cn("absolute left-1.5 text-[10px] leading-none font-medium", checked ? "opacity-100" : "opacity-0")}>{checkedChildren}</span> : null}
            <span
                aria-hidden="true"
                data-state={checked ? "on" : "off"}
                className={cn("pv-switch__thumb absolute left-0.5 top-1/2 grid -translate-y-1/2 place-items-center rounded-full transition-transform duration-150 ease-out", geometry.thumb, geometry.offset)}
            >
                {loading ? <span className="size-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" /> : null}
            </span>
        </button>
    );
}
