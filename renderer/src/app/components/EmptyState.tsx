import { type IconName, IconSymbol } from "./IconSymbol";

export function EmptyState(
  { icon = "box", text }: { icon?: IconName; text: string },
) {
  return (
    <div className="empty">
      <div className="empty-inner">
        <IconSymbol name={icon} />
        <div>{text}</div>
      </div>
    </div>
  );
}
