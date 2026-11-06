import { t } from '@/i18n';
import { store } from "../../store/projectStore";
import { Checkbox, Empty, Modal, Spin, Tabs } from "antd";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useWorkbenchSurfaceRoot } from "../layout/workbenchSurface";
import { IconSymbol } from "../components/IconSymbol";
import { getDomainRevision, subscribeDomain } from "../../store/domainReactivity";
import {
  editorMediaUsage,
  listEditorMediaCandidates,
  type EditorMediaCandidate,
} from "../../services/editorMediaCatalog";
import { mediaPosterUrl } from "../../services/mediaPoster";
import { editorMediaClock } from "./editorMediaPresentation";
import type { MediaBatchResult, MediaImportFailure } from "./openReel/mediaBatchImport";

/**
 * 剪辑台「添加媒体」的宿主选择器。
 *
 * 参考实现里剪辑台不弹操作系统文件框：宿主把自己真实拥有的资源清单（连线产物 /
 * 画布产物 / 项目素材）交给一个资源选择器，用户在里面挑，确认后才由宿主取字节导入。
 * 候选集、稳定 key 与「已添加」判定全部来自 services/editorMediaCatalog，
 * 与 Agent 的 video_project_media 是同一份数据，两侧不会挑出不同素材。
 */

const MAX_SELECTION = 50;
const TYPE_FILTERS = [
  { id: "all", label: t("ui.taskAdapter.label.778fc8f9") },
  { id: "video", label: t("ui.canvasMediaActions.text.fa4e33b6") },
  { id: "audio", label: t("ui.canvasAdapter.label.461189f1") },
  { id: "image", label: t("ui.canvasMediaActions.text.be8da62e") },
] as const;

type TypeFilter = (typeof TYPE_FILTERS)[number]["id"];
type Tab = "connected" | "canvas" | "material";
const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  { id: "connected", label: t("ui.AssetPickerDialog.label.c473459b"), empty: t("ui.AssetPickerDialog.empty.f4118440") },
  { id: "canvas", label: t("ui.AssetPickerDialog.label.0fd0d9da"), empty: t("ui.AssetPickerDialog.empty.f33ca6fc") },
  { id: "material", label: t("ui.AssetPickerDialog.label.5be49fff"), empty: t("ui.AssetPickerDialog.empty.57a114e6") },
];

function CandidateThumb({ candidate, view, duration }: { candidate: EditorMediaCandidate; view: "grid" | "list"; duration: string }) {
  const [poster, setPoster] = useState(candidate.type === "image" ? candidate.previewUrl : "");
  useEffect(() => {
    if (candidate.type === "image") {
      setPoster(candidate.previewUrl);
      return;
    }
    let active = true;
    void mediaPosterUrl({ sourceFile: candidate.sourceFile, sourceUrl: candidate.previewUrl })
      .then((url) => {
        if (active) setPoster(url);
      })
      .catch(() => setPoster(""));
    return () => {
      active = false;
    };
  }, [candidate.type, candidate.sourceFile, candidate.previewUrl]);
  return (
    <span className={`ov-picker-thumb${view === "list" ? " list" : ""}`} data-type={candidate.type}>
      {poster
        ? <img src={poster} alt="" loading="lazy" />
        : <IconSymbol name={candidate.type === "audio" ? "waveform" : candidate.type === "image" ? "image" : "film"} />}
      {duration && <span className="ov-picker-duration">{duration}</span>}
    </span>
  );
}

export function AssetPickerDialog({
  open,
  nodeId,
  project,
  busy,
  onClose,
  onConfirm,
  onLocalUpload,
}: {
  open: boolean;
  nodeId?: string;
  project: Record<string, any> | null | undefined;
  busy: boolean;
  onClose: () => void;
  onConfirm: (keys: string[]) => Promise<MediaBatchResult | void>;
  onLocalUpload: () => Promise<void>;
}) {
  // 候选清单是领域状态：画布新增产物或素材入库时，选择器要立刻看到同一份目录。
  useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const surface = useWorkbenchSurfaceRoot();
  const [tab, setTab] = useState<Tab>("canvas");
  const [keyword, setKeyword] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [tag, setTag] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selected, setSelected] = useState<string[]>([]);
  const [failures, setFailures] = useState<MediaImportFailure[]>([]);

  const usage = editorMediaUsage(project);
  const allCandidates = listEditorMediaCandidates();
  const connected = new Set(store.project.edges.filter((edge: any) => edge.target === nodeId).map((edge: any) => edge.source));
  const tabCandidates = allCandidates.filter((candidate) => {
    if (tab === "connected") return candidate.origin === "canvas" && connected.has(candidate.nodeId);
    return candidate.origin === (tab === "canvas" ? "canvas" : "material");
  });

  const tagList = [...new Set(tabCandidates.flatMap((candidate) => candidate.tags))].sort();

  const matchesFilters = (candidate: EditorMediaCandidate) => {
    if (typeFilter !== "all" && candidate.type !== typeFilter) return false;
    if (tag && !candidate.tags.includes(tag)) return false;
    const needle = keyword.trim().toLowerCase();
    if (!needle) return true;
    return [candidate.name, candidate.alias, candidate.nodeId]
      .some((field) => String(field || "").toLowerCase().includes(needle));
  };

  const filtered = typeFilter !== "all" || Boolean(tag) || Boolean(keyword.trim());
  const filtersActive = filtered || availableOnly;
  const rows = tabCandidates.filter(matchesFilters);
  const visible = availableOnly ? rows.filter((candidate) => !usage.has(candidate)) : rows;

  const counts: Record<TypeFilter, number> = { all: 0, video: 0, audio: 0, image: 0 };
  for (const candidate of rows) {
    counts.all += 1;
    counts[candidate.type as TypeFilter] += 1;
  }

  useEffect(() => {
    if (!open) {
      setSelected([]);
      setFailures([]);
      setKeyword("");
      setTypeFilter("all");
      setTag("");
      setAvailableOnly(false);
      return;
    }
    setTab(connected.size ? "connected" : "canvas");
  }, [open, nodeId]);

  const toggle = (candidate: EditorMediaCandidate) => {
    setSelected((current) => {
      if (current.includes(candidate.key)) return current.filter((key) => key !== candidate.key);
      return current.length >= MAX_SELECTION ? current : [...current, candidate.key];
    });
  };

  const clearFilters = () => {
    setTypeFilter("all");
    setKeyword("");
    setTag("");
    setAvailableOnly(false);
  };

  const confirm = async () => {
    const result = await onConfirm(selected.slice());
    if (!result) return;
    setFailures(result.failures);
    // Successful uses have already been placed. A retry must only contain failures.
    setSelected(result.failures.map((failure) => failure.key));
  };

  const selectedNames = selected
    .map((key) => allCandidates.find((c) => c.key === key)?.name || "")
    .filter(Boolean);

  const renderTile = (candidate: EditorMediaCandidate) => {
    const added = usage.has(candidate);
    const order = selected.indexOf(candidate.key);
    const clock = candidate.durationSec > 0 ? editorMediaClock(candidate.durationSec) : "";
    return (
      <button
        key={candidate.key}
        type="button"
        className={`ov-picker-tile${order >= 0 ? " selected" : ""}${added ? " added" : ""}`}
        data-view={view}
        disabled={busy}
        aria-pressed={order >= 0}
        title={candidate.name}
        onClick={() => toggle(candidate)}
      >
        <CandidateThumb candidate={candidate} view={view} duration={view === "grid" ? clock : ""} />
        <span className="ov-picker-name">{candidate.name}</span>
        {view === "list" && clock && <span className="ov-picker-duration list">{clock}</span>}
        {added
          ? <span className="ov-picker-added"><IconSymbol name="check" />{t("ui.AssetPickerDialog.text.8aed81f8")}</span>
          : order >= 0 && <span className="ov-picker-order">{order + 1}</span>}
      </button>
    );
  };

  if (!open || !surface) return null;
  // 挂进工作区内容区而不是剪辑台容器：剪辑器是独立 iframe，遮罩留在里面
  // 盖不住宿主侧，也会被容器裁剪成一小块。
  return (
    <Modal
      open
      centered
      width={920}
      title={t("ui.AssetPickerDialog.arialabel.9d557f2a")}
      footer={null}
      onCancel={onClose}
      maskClosable={!busy}
      keyboard={!busy}
      closable={!busy}
      getContainer={() => surface}
      className="ov-picker-modal"
      styles={{ body: { padding: 0 } }}
    >
      <div className={`ov-picker${failures.length ? " has-failures" : ""}`}>
        <Tabs
          className="ov-picker-tabs"
          activeKey={tab}
          onChange={(key) => setTab(key as Tab)}
          items={TABS.map((item) => {
            const count = allCandidates.filter((c) => item.id === "connected"
              ? c.origin === "canvas" && connected.has(c.nodeId)
              : c.origin === (item.id === "canvas" ? "canvas" : "material")).length;
            return {
              key: item.id,
              label: (
                <span className="ov-picker-tab-label">
                  {item.label}
                  <span>{count}</span>
                </span>
              ),
            };
          })}
        />
        <div className="ov-picker-body">
          <aside className="ov-picker-aside">
            <label className="ov-picker-search">
              <IconSymbol name="search" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder={t("ui.AssetPickerDialog.placeholder.781d5ebd")}
                aria-label={t("ui.AssetPickerDialog.placeholder.781d5ebd")}
              />
            </label>
            <div className="ov-picker-types">
              {TYPE_FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={typeFilter === item.id ? "active" : ""}
                  onClick={() => setTypeFilter(item.id)}
                >
                  <span>{item.label}</span>
                  <span className="ov-picker-count">{counts[item.id]}</span>
                </button>
              ))}
            </div>
            {tagList.length > 0 && (
              <div className="ov-picker-tags">
                <span className="ov-picker-section-label">{t("ui.AssetPickerDialog.text.ae0a7afe")}</span>
                {tagList.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={tag === item ? "active" : ""}
                    onClick={() => setTag(tag === item ? "" : item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
          </aside>
          <div className="ov-picker-main">
            <div className="ov-picker-bar">
              <div className="ov-picker-view" role="group" aria-label={t("ui.AssetPickerDialog.arialabel.cebbb470")}>
                <button
                  type="button"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                  title={t("ui.BottomModeBar.text.cd1bbb12")}
                >
                  <IconSymbol name="grid" />
                </button>
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                  title={t("ui.AssetPickerDialog.title.d46f82fd")}
                >
                  <IconSymbol name="list" />
                </button>
              </div>
              <Checkbox
                className="ov-picker-available"
                checked={availableOnly}
                onChange={(event) => setAvailableOnly(event.target.checked)}
              >
                {t("ui.AssetPickerDialog.text.7c27d9e2")}
              </Checkbox>
              {tag && (
                <button type="button" className="ov-picker-tag-chip" onClick={() => setTag("")}>
                  {tag}
                  <IconSymbol name="x" />
                </button>
              )}
            </div>
            <Spin spinning={busy}>
              <div className={`ov-picker-grid${view === "list" ? " list" : ""}`}>
                <button
                  type="button"
                  className="ov-picker-upload"
                  data-view={view}
                  disabled={busy}
                  onClick={() => void onLocalUpload()}
                >
                  <IconSymbol name="upload" />
                  {t("ui.AssetPickerDialog.text.16367f3d")}</button>
                {visible.map(renderTile)}
                {/* 空态在滚动区里排在上传入口之后：筛选没命中时本地上传依然可用。 */}
                {!visible.length && (
                  <div className="ov-picker-empty">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={filtered || availableOnly ? t("ui.AssetPickerDialog.text.eaab7302") : TABS.find((item) => item.id === tab)?.empty}
                    />
                    {filtersActive && (
                      <button type="button" onClick={clearFilters}>{t("ui.AssetPickerDialog.text.4bbc4e5f")}</button>
                    )}
                  </div>
                )}
              </div>
            </Spin>
          </div>
        </div>
        {failures.length > 0 && <div className="ov-picker-failures" role="alert">
          <strong>{t(failures.length === 1 ? "editor.media.addFailures.one" : "editor.media.addFailures.other", { count: failures.length })}</strong>
          <ul>{failures.map((failure) => <li key={failure.key}>{failure.name}：{failure.error}</li>)}</ul>
        </div>}
        <footer className="ov-picker-foot">
          <span
            className="ov-picker-selected"
            aria-live="polite"
            title={selectedNames.join("、")}
          >
            {t("editor.media.selectionCount", { count: selected.length, max: MAX_SELECTION })}</span>
          <div>
            <button type="button" onClick={onClose} disabled={busy}>{t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
            <button
              type="button"
              className="primary"
              disabled={busy || !selected.length}
              onClick={() => void confirm()}
            >
              {busy ? t("ui.AssetPickerDialog.text.cd74f096") : failures.length ? t("ui.AssetPickerDialog.text.5bf7c8fd") : t("ui.AssetPickerDialog.text.b56d9ac6")}
            </button>
          </div>
        </footer>
      </div>
    </Modal>
  );
}
