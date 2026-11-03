import { t } from '@/i18n';

const SPARKS = [1, 2, 3];

/** 仅呈现工作台初始化；不保存工程状态，也不伪造进度。 */
export function CanvasStartup({ canvasReady }: { canvasReady: boolean }) {
  return (
    <div className="canvas-startup" role="status" aria-live="polite">
      <div className="canvas-startup-wave" aria-hidden="true" />
      <div className="canvas-startup-badge">
        <div className="canvas-startup-loader" aria-hidden="true">
          <div className="canvas-startup-orb">
            <img className="canvas-startup-body" src="./shotloom-mascot-body.png" alt="" />
            {SPARKS.map((index) => (
              <img
                key={index}
                className="canvas-startup-spark"
                src={`./shotloom-mascot-spark-${index}.png`}
                alt=""
              />
            ))}
          </div>
        </div>
        <span>{canvasReady ? t('agent.preparingConnection') : t('canvas.preparing')}</span>
      </div>
    </div>
  );
}
