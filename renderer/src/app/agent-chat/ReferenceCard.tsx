import { IconSymbol } from "../components/IconSymbol";
import { MediaThumb } from "./MediaThumb";
import type { AgentReference } from "./mediaReference";
import styles from "./ReferenceCard.module.css";

/**
 * 引用素材卡。输入区和用户气泡共用同一份呈现，
 * 用户发出去的东西必须和发之前看到的一致。
 */
export function ReferenceCard({
  reference,
  onRemove,
}: {
  reference: AgentReference;
  onRemove?: () => void;
}) {
  return (
    <div className={styles.card} title={reference.label}>
      <MediaThumb
        kind={reference.kind}
        path={reference.path}
        fallbackUrl={reference.url}
        label={reference.label}
      />
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          aria-label={`移除引用：${reference.label}`}
        >
          <IconSymbol name="x" />
        </button>
      )}
    </div>
  );
}
