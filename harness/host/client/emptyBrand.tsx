import { t } from './i18n';
import { useEffect, useRef } from 'react';

/** Brand-only empty state; no product store imports enter the isolated iframe. */
export function EmptyBrand() {
  const mark = useRef<HTMLDivElement>(null);
  const pupils = useRef<SVGGElement>(null);
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const reset = () => { cancelAnimationFrame(frame); pupils.current?.setAttribute('transform', 'translate(0 0)'); };
    const follow = (event: PointerEvent) => {
      if (motion.matches) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = mark.current?.getBoundingClientRect();
        if (!rect) return;
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        const distance = Math.hypot(x, y);
        const scale = distance ? Math.min(1, distance / 180) / distance : 0;
        pupils.current?.setAttribute('transform', `translate(${x * scale * 5} ${y * scale * 7})`);
      });
    };
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('blur', reset);
    document.documentElement.addEventListener('pointerleave', reset);
    motion.addEventListener('change', reset);
    return () => {
      reset();
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('blur', reset);
      document.documentElement.removeEventListener('pointerleave', reset);
      motion.removeEventListener('change', reset);
    };
  }, []);
  return <section className="shotloom-empty-state" aria-label={t("ui.emptyBrand.arialabel.b7121556")}><div className="shotloom-empty-brand" ref={mark} role="img" aria-label="Shotloom">
    <img src="./shotloom-logo.png" alt="" />
    <svg viewBox="0 0 256 256" aria-hidden="true">
      <ellipse cx="56.3" cy="143.2" rx="33.1" ry="30.2" fill="#fff" transform="rotate(-37 56.3 143.2)" />
      <ellipse cx="134.4" cy="176.4" rx="30.6" ry="32.9" fill="#fff" transform="rotate(-8.3 134.4 176.4)" />
      <g ref={pupils}>
        <ellipse cx="62.8" cy="146" rx="16.3" ry="15.4" fill="#0a0a0d" /><circle cx="73.5" cy="141.2" r="3.6" fill="#fff" />
        <ellipse cx="135.6" cy="177.3" rx="15.2" ry="16.6" fill="#0a0a0d" /><circle cx="146.4" cy="172.8" r="3.5" fill="#fff" />
      </g>
    </svg>
  </div><h1>{t("ui.emptyBrand.text.fdd01b6b")}</h1><p>{t("ui.emptyBrand.text.b70667df")}</p></section>;
}
