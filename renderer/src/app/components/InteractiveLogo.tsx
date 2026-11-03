import { useEffect, useRef } from "react";

interface InteractiveLogoProps {
  src: string;
  thinking?: boolean;
  className?: string | undefined;
}

export function InteractiveLogo({ src, className = "", thinking = false }: InteractiveLogoProps) {
  const logoRef = useRef<HTMLSpanElement>(null);
  const pupilsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (thinking) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let animationFrame = 0;

    function resetPupils() {
      cancelAnimationFrame(animationFrame);
      pupilsRef.current?.setAttribute("transform", "translate(0 0)");
    }

    function followPointer(event: PointerEvent) {
      if (reducedMotion.matches) return;
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const logo = logoRef.current;
        const pupils = pupilsRef.current;
        if (!logo || !pupils) return;

        const bounds = logo.getBoundingClientRect();
        const deltaX = event.clientX - (bounds.left + bounds.width / 2);
        const deltaY = event.clientY - (bounds.top + bounds.height / 2);
        const distance = Math.hypot(deltaX, deltaY);
        if (distance === 0) {
          pupils.setAttribute("transform", "translate(0 0)");
          return;
        }

        const strength = Math.min(1, distance / 180);
        const eyeX = (deltaX / distance) * 5 * strength;
        const eyeY = (deltaY / distance) * 7 * strength;
        pupils.setAttribute("transform", `translate(${eyeX} ${eyeY})`);
      });
    }

    window.addEventListener("pointermove", followPointer, { passive: true });
    window.addEventListener("blur", resetPupils);
    document.documentElement.addEventListener("pointerleave", resetPupils);
    reducedMotion.addEventListener("change", resetPupils);
    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("pointermove", followPointer);
      window.removeEventListener("blur", resetPupils);
      document.documentElement.removeEventListener("pointerleave", resetPupils);
      reducedMotion.removeEventListener("change", resetPupils);
    };
  }, [thinking]);

  return (
    <span
      ref={logoRef}
      className={`sidebar-brand-logo${thinking ? " is-thinking" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      <img src={src} alt="" />
      <svg className="sidebar-brand-eyes" viewBox="0 0 256 256">
        <ellipse
          cx="56.3"
          cy="143.2"
          rx="33.1"
          ry="30.2"
          fill="#fff"
          transform="rotate(-37 56.3 143.2)"
        />
        <ellipse
          cx="134.4"
          cy="176.4"
          rx="30.6"
          ry="32.9"
          fill="#fff"
          transform="rotate(-8.3 134.4 176.4)"
        />
        <g ref={pupilsRef}>
          <ellipse cx="62.8" cy="146" rx="16.3" ry="15.4" fill="#0a0a0d" />
          <circle cx="73.5" cy="141.2" r="3.6" fill="#fff" />
          <ellipse cx="135.6" cy="177.3" rx="15.2" ry="16.6" fill="#0a0a0d" />
          <circle cx="146.4" cy="172.8" r="3.5" fill="#fff" />
        </g>
      </svg>
    </span>
  );
}
