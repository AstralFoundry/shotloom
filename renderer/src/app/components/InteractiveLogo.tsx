import { useEffect, useRef } from "react";

interface InteractiveLogoProps {
  src: string;
}

export function InteractiveLogo({ src }: InteractiveLogoProps) {
  const logoRef = useRef<HTMLSpanElement>(null);
  const pupilsRef = useRef<SVGGElement>(null);

  useEffect(() => {
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
  }, []);

  return (
    <span ref={logoRef} className="sidebar-brand-logo" aria-hidden="true">
      <img src={src} alt="" />
      <svg className="sidebar-brand-eyes" viewBox="0 0 256 256">
        <ellipse
          cx="52"
          cy="143"
          rx="29"
          ry="36"
          fill="#fff"
          transform="rotate(-8 52 143)"
        />
        <ellipse cx="126" cy="157" rx="28" ry="34" fill="#fff" />
        <g ref={pupilsRef}>
          <ellipse cx="52" cy="143" rx="20" ry="26" fill="#0a0a0d" />
          <circle cx="58" cy="131" r="5" fill="#fff" />
          <ellipse cx="126" cy="157" rx="19" ry="24" fill="#0a0a0d" />
          <circle cx="132" cy="145" r="5" fill="#fff" />
        </g>
      </svg>
    </span>
  );
}
