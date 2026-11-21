import { isValidElement, useRef, type ReactElement, type ReactNode } from "react";
import { Focusable, Tooltip as RACTooltip, TooltipTrigger, type Placement } from "react-aria-components";

import { cn } from "@/host/cn";

/**
 * Tooltip — hover/focus hint for icon buttons (RAC overlay, AntD-compatible props).
 *
 * The trigger gets a stable ref so the bubble always anchors to the control instead of
 * falling back to the viewport origin when the child re-renders.
 */

export type TooltipPlacement = "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight" | "left" | "right";

const PLACEMENT_MAP: Record<TooltipPlacement, Placement> = {
    top: "top",
    topLeft: "top left",
    topRight: "top right",
    bottom: "bottom",
    bottomLeft: "bottom left",
    bottomRight: "bottom right",
    left: "left",
    right: "right",
};

export interface TooltipProps {
    title?: ReactNode;
    placement?: TooltipPlacement;
    delay?: number;
    className?: string;
    children: ReactNode;
}

export function Tooltip({ title, placement = "top", delay = 500, className, children }: TooltipProps) {
    const triggerRef = useRef<HTMLSpanElement>(null);
    if (!title) return <>{children}</>;
    const child = isValidElement<{ disabled?: boolean; loading?: boolean; tabIndex?: number }>(children) ? children : null;
    const directTrigger =
        child && !child.props.disabled && !child.props.loading && (typeof child.type !== "string" || ["button", "a", "input", "select", "textarea", "summary"].includes(child.type) || child.props.tabIndex !== undefined);

    return (
        <TooltipTrigger delay={delay}>
            <span ref={triggerRef} className="inline-flex">
                {directTrigger ? <Focusable>{child as unknown as ReactElement<Record<string, unknown>, string>}</Focusable> : <Focusable excludeFromTabOrder><span className="inline-flex">{children}</span></Focusable>}
            </span>
            <RACTooltip triggerRef={triggerRef} placement={PLACEMENT_MAP[placement]} offset={8} className={cn("previs-host-tooltip ra-pop-in", className)}>
                {title}
            </RACTooltip>
        </TooltipTrigger>
    );
}
