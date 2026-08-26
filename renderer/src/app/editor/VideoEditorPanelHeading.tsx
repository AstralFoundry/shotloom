export function VideoEditorPanelHeading({ title, count }: { title: string; count: number }) {
  return (
    <header className="ov-panel-heading">
      <div>
        <small>编辑面板</small>
        <strong>{title}</strong>
      </div>
      <span>{count}</span>
    </header>
  );
}
