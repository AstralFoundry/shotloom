import { Dropdown, type MenuProps } from "antd";

/**
 * 右键菜单的共享锚点：坐标仍由调用方从 contextmenu 事件取，
 * 边缘翻转、键盘导航和点外关闭交给 antd Dropdown，避免每个视图各写一份。
 */
export function ContextMenu({ point, items, onSelect, onClose }: {
  point: { x: number; y: number } | null;
  items: NonNullable<MenuProps["items"]>;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Dropdown
      open={Boolean(point)}
      trigger={[]}
      placement="bottomLeft"
      menu={{
        items,
        onClick: ({ key }) => onSelect(key),
      }}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <span
        className="context-menu-anchor"
        style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
      />
    </Dropdown>
  );
}
