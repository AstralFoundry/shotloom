import { t } from '../../i18n';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type MutableRefObject,
} from "react";
import {
  Box,
  Boxes,
  Camera,
  ChevronRight,
  Expand,
  Grid2X2,
  Grid3X3,
  ImagePlus,
  Move3D,
  Plus,
  Ratio,
  Rotate3D,
  Scale3D,
  Trash2,
  UserPlus,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { requestViewportCapture } from "../io/captureBridge";
import { readLocalModelFile } from "../loaders/localModelImport";
import { readPanoramaFile } from "../loaders/panoramaImport";
import {
  getModelLibraryItems,
  MODEL_LIBRARY_CATEGORIES,
  type ModelLibraryCategoryId,
  type ModelLibraryItem,
} from "../modelLibrary/modelLibraryCatalog";
import {
  VIEWPORT_ASPECT_RATIO_OPTIONS,
  type ViewportAspectRatio,
} from "../schema/viewportAspectRatio";
import { BODY_TYPE_OPTIONS, type CharacterBodyType } from "../runtime/mannequin/bodyTypes";
import { GEOMETRY_PRIMITIVE_OPTIONS, type GeometryPrimitiveType } from "../schema/directorProject";
import {
  useDirectorStore,
  type CameraShotSnapshot,
  type CrowdCharactersInput,
  type TransformMode,
} from "../store/directorStore";

type ToolbarAction = {
  label: string;
  icon: LucideIcon;
  mode?: TransformMode;
  onClick: () => void;
};

const DEFAULT_VIEWPORT_TOOLBAR_HEIGHT = 46;
const DEFAULT_CROWD_ROWS = 3;
const DEFAULT_CROWD_COLUMNS = 3;
const DEFAULT_CROWD_SPACING = 1.2;
const MIN_CROWD_GRID_SIZE = 1;
const MAX_CROWD_GRID_SIZE = 12;
const MIN_CROWD_SPACING = 0.1;
const MAX_CROWD_SPACING = 10;

function clampCrowdGridSize(value: number) {
  if (!Number.isFinite(value)) return MIN_CROWD_GRID_SIZE;
  return Math.min(MAX_CROWD_GRID_SIZE, Math.max(MIN_CROWD_GRID_SIZE, Math.round(value)));
}

function clampCrowdSpacing(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_CROWD_SPACING;
  return Math.min(MAX_CROWD_SPACING, Math.max(MIN_CROWD_SPACING, Number(value.toFixed(2))));
}

function waitForNextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function ViewportToolbar({
  getViewportCameraSnapshot,
  toolbarContainerRef,
}: {
  getViewportCameraSnapshot?: () => CameraShotSnapshot;
  toolbarContainerRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const aspectRatioPanelRef = useRef<HTMLDivElement | null>(null);
  const characterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const geometryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const crowdTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modelLibraryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const characterMenuRef = useRef<HTMLDivElement | null>(null);
  const geometryMenuRef = useRef<HTMLDivElement | null>(null);
  const crowdPanelRef = useRef<HTMLDivElement | null>(null);
  const modelLibraryPanelRef = useRef<HTMLDivElement | null>(null);
  const sceneLocalModelInputRef = useRef<HTMLInputElement | null>(null);
  const libraryLocalModelInputRef = useRef<HTMLInputElement | null>(null);
  const panoramaInputRef = useRef<HTMLInputElement | null>(null);
  const [characterMenuOpen, setCharacterMenuOpen] = useState(false);
  const [geometryMenuOpen, setGeometryMenuOpen] = useState(false);
  const [crowdPanelOpen, setCrowdPanelOpen] = useState(false);
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const [aspectRatioPanelOpen, setAspectRatioPanelOpen] = useState(false);
  const [toolbarHeight, setToolbarHeight] = useState(DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
  const [characterMenuStyle, setCharacterMenuStyle] = useState<CSSProperties>({});
  const [geometryMenuStyle, setGeometryMenuStyle] = useState<CSSProperties>({});
  const [crowdPanelStyle, setCrowdPanelStyle] = useState<CSSProperties>({});
  const [modelLibraryPanelStyle, setModelLibraryPanelStyle] = useState<CSSProperties>({});
  const [crowdBodyType] = useState<CharacterBodyType>(BODY_TYPE_OPTIONS[0]?.bodyType ?? "mannequin");
  const [crowdRows, setCrowdRows] = useState(String(DEFAULT_CROWD_ROWS));
  const [crowdColumns, setCrowdColumns] = useState(String(DEFAULT_CROWD_COLUMNS));
  const [crowdSpacing, setCrowdSpacing] = useState(String(DEFAULT_CROWD_SPACING));
  const [activeModelLibraryCategoryId, setActiveModelLibraryCategoryId] =
    useState<ModelLibraryCategoryId>("convenience");
  const addImportedAsset = useDirectorStore((state) => state.addImportedAsset);
  const addObjectFromAsset = useDirectorStore((state) => state.addObjectFromAsset);
  const removeImportedAsset = useDirectorStore((state) => state.removeImportedAsset);
  const assets = useDirectorStore((state) => state.project.assets);
  const addPresetCharacter = useDirectorStore((state) => state.addPresetCharacter);
  const addCrowdCharacters = useDirectorStore((state) => state.addCrowdCharacters);
  const addGeometryPrimitive = useDirectorStore((state) => state.addGeometryPrimitive);
  const addCameraShot = useDirectorStore((state) => state.addCameraShot);
  const addCameraCaptures = useDirectorStore((state) => state.addCameraCaptures);
  const activeCameraId = useDirectorStore((state) => state.project.activeCameraId);
  const viewMode = useDirectorStore((state) => state.viewMode);
  const transformMode = useDirectorStore((state) => state.transformMode);
  const viewportAspectRatio = useDirectorStore((state) => state.viewportAspectRatio);
  const setViewMode = useDirectorStore((state) => state.setViewMode);
  const setTransformMode = useDirectorStore((state) => state.setTransformMode);
  const setViewportAspectRatio = useDirectorStore((state) => state.setViewportAspectRatio);
  const toggleViewportPanelsCollapsed = useDirectorStore((state) => state.toggleViewportPanelsCollapsed);

  useEffect(() => {
    if (!characterMenuOpen && !crowdPanelOpen && !modelLibraryOpen && !aspectRatioPanelOpen) return;

    function closeMenusOnOutsidePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && toolbarRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && characterMenuRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && geometryMenuRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && crowdPanelRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && modelLibraryPanelRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && aspectRatioPanelRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && sceneLocalModelInputRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && libraryLocalModelInputRef.current?.contains(event.target)) return;
      if (event.target instanceof Node && panoramaInputRef.current?.contains(event.target)) return;

      setCharacterMenuOpen(false);
      setGeometryMenuOpen(false);
      setCrowdPanelOpen(false);
      setModelLibraryOpen(false);
      setAspectRatioPanelOpen(false);
    }

    document.addEventListener("pointerdown", closeMenusOnOutsidePointerDown);

    return () => {
      document.removeEventListener("pointerdown", closeMenusOnOutsidePointerDown);
    };
  }, [aspectRatioPanelOpen, characterMenuOpen, crowdPanelOpen, modelLibraryOpen]);

  useLayoutEffect(() => {
    const element = toolbarRef.current;
    if (!element) return;

    const updateHeight = () => {
      const nextHeight = Math.max(element.offsetHeight, DEFAULT_VIEWPORT_TOOLBAR_HEIGHT);
      setToolbarHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
    };

    updateHeight();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => {
        window.removeEventListener("resize", updateHeight);
      };
    }

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useLayoutEffect(() => {
    const toolbarElement = toolbarRef.current;
    const frameElement = toolbarElement?.parentElement;
    if (!toolbarElement || !frameElement) return;

    const updateFloatingPositions = () => {
      const frameRect = frameElement.getBoundingClientRect();

      if (characterMenuOpen && characterTriggerRef.current) {
        const triggerRect = characterTriggerRef.current.getBoundingClientRect();
        setCharacterMenuStyle({
          left: `${triggerRect.left - frameRect.left + triggerRect.width / 2}px`,
          bottom: `${frameRect.bottom - triggerRect.top + 8}px`,
        });
      }

      if (geometryMenuOpen && geometryTriggerRef.current) {
        const triggerRect = geometryTriggerRef.current.getBoundingClientRect();
        setGeometryMenuStyle({
          left: `${triggerRect.right - frameRect.left + 8}px`,
          bottom: `${frameRect.bottom - triggerRect.bottom}px`,
        });
      }

      if (crowdPanelOpen && crowdTriggerRef.current) {
        const triggerRect = crowdTriggerRef.current.getBoundingClientRect();
        setCrowdPanelStyle({
          left: `${triggerRect.right - frameRect.left + 8}px`,
          bottom: `${frameRect.bottom - triggerRect.bottom}px`,
        });
      }

      if (modelLibraryOpen) {
        const toolbarRect = toolbarElement.getBoundingClientRect();
        setModelLibraryPanelStyle({
          left: `${toolbarRect.left - frameRect.left + toolbarRect.width / 2}px`,
          bottom: `${frameRect.bottom - toolbarRect.top + 10}px`,
        });
      }
    };

    updateFloatingPositions();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateFloatingPositions);
      return () => {
        window.removeEventListener("resize", updateFloatingPositions);
      };
    }

    const resizeObserver = new ResizeObserver(updateFloatingPositions);
    resizeObserver.observe(frameElement);
    resizeObserver.observe(toolbarElement);
    if (characterTriggerRef.current) {
      resizeObserver.observe(characterTriggerRef.current);
    }
    if (geometryTriggerRef.current) {
      resizeObserver.observe(geometryTriggerRef.current);
    }
    if (crowdTriggerRef.current) {
      resizeObserver.observe(crowdTriggerRef.current);
    }
    if (modelLibraryTriggerRef.current) {
      resizeObserver.observe(modelLibraryTriggerRef.current);
    }
    window.addEventListener("resize", updateFloatingPositions);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateFloatingPositions);
    };
  }, [characterMenuOpen, crowdPanelOpen, geometryMenuOpen, modelLibraryOpen]);

  async function handleLocalModelChange(
    event: ChangeEvent<HTMLInputElement>,
    addToScene: boolean
  ) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;

    try {
      for (const file of files) {
        const result = await readLocalModelFile(file);
        addImportedAsset({
          kind: "prop",
          ...result,
          addToScene,
          assetSource: "local",
        });
      }
    } catch {
      // The toolbar keeps file actions quiet; detailed import feedback lives in the side panel.
    } finally {
      input.value = "";
    }
  }

  async function handlePanoramaChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const result = await readPanoramaFile(file);
      addImportedAsset({ kind: "panorama", ...result });
    } catch {
      // The toolbar keeps file actions quiet; detailed import feedback lives in the side panel.
    } finally {
      input.value = "";
    }
  }

  async function handleCapture(preset: "current" | "four" | "twelve") {
    try {
      const targetCameraId =
        viewMode === "director" ? addCameraShot(getViewportCameraSnapshot?.()) : activeCameraId;

      setViewMode("camera");
      await waitForNextAnimationFrame();

      const results = await requestViewportCapture({
        preset,
        source: "camera-panel",
        cameraId: targetCameraId,
      });
      addCameraCaptures(targetCameraId, results.map((result) => result.dataUrl));
    } catch {
      // Keep the capsule toolbar icon-only and free of transient status text.
    }
  }

  function selectTransformMode(mode: TransformMode) {
    setTransformMode(mode);
  }

  function toggleCharacterMenu() {
    setCharacterMenuOpen((isOpen) => !isOpen);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
    setModelLibraryOpen(false);
    setAspectRatioPanelOpen(false);
  }

  function addCharacterWithBodyType(bodyType: CharacterBodyType) {
    addPresetCharacter(bodyType);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
  }

  function addGeometryWithType(geometryType: GeometryPrimitiveType) {
    addGeometryPrimitive(geometryType);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
  }

  function openCrowdPanel() {
    setCrowdPanelOpen(true);
    setGeometryMenuOpen(false);
  }

  function closeCrowdPanel() {
    setCrowdPanelOpen(false);
  }

  function getCrowdInputValue(): CrowdCharactersInput {
    return {
      bodyType: crowdBodyType,
      rows: clampCrowdGridSize(Number(crowdRows)),
      columns: clampCrowdGridSize(Number(crowdColumns)),
      spacing: clampCrowdSpacing(Number(crowdSpacing)),
    };
  }

  function applyCrowdValueDrafts(input: CrowdCharactersInput) {
    setCrowdRows(String(input.rows));
    setCrowdColumns(String(input.columns));
    setCrowdSpacing(String(input.spacing));
  }

  function addCrowd() {
    const nextInput = getCrowdInputValue();
    applyCrowdValueDrafts(nextInput);
    addCrowdCharacters(nextInput);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
  }

  function toggleModelLibrary() {
    setModelLibraryOpen((isOpen) => !isOpen);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
    setAspectRatioPanelOpen(false);
  }

  function addModelLibraryItem(item: ModelLibraryItem) {
    addImportedAsset({
      kind: "prop",
      assetSource: "library",
      fileName: item.fileName,
      name: item.name,
      url: item.url,
    });
    setModelLibraryOpen(false);
  }

  async function handleMyModelsImport() {
    libraryLocalModelInputRef.current?.click();
  }

  const myModelLibraryItems: ModelLibraryItem[] = assets
    .filter((asset) => asset.sourceType === "model" && asset.assetSource === "local")
    .map(
      (asset) =>
        ({
          categoryId: "my-models",
          fileName: asset.fileName,
          id: asset.id,
          name: asset.name ?? asset.fileName.replace(/\.(fbx|obj)$/i, ""),
          url: asset.url,
        }) satisfies ModelLibraryItem
    );

  function addCameraFromViewport() {
    const snapshot = getViewportCameraSnapshot?.();
    addCameraShot(snapshot);
  }

  function toggleAspectRatioPanel() {
    setAspectRatioPanelOpen((isOpen) => !isOpen);
    setCharacterMenuOpen(false);
    setGeometryMenuOpen(false);
    setCrowdPanelOpen(false);
    setModelLibraryOpen(false);
  }

  function selectAspectRatio(ratio: ViewportAspectRatio) {
    setViewportAspectRatio(ratio);
    setAspectRatioPanelOpen(false);
  }

  const actions: ToolbarAction[] = [
    { label: t("ui.ViewportToolbar.label.591f3aa5"), icon: Move3D, mode: "translate", onClick: () => selectTransformMode("translate") },
    { label: t("ui.ImageWatermarkEditor.label.a69e51e5"), icon: Rotate3D, mode: "rotate", onClick: () => selectTransformMode("rotate") },
    { label: t("ui.ViewportToolbar.label.12e2ed4d"), icon: Scale3D, mode: "scale", onClick: () => selectTransformMode("scale") },
    { label: t("ui.ViewportToolbar.label.b6728320"), icon: ImagePlus, onClick: () => panoramaInputRef.current?.click() },
    {
      label: t("ui.ViewportToolbar.label.32a9d236"),
      icon: Box,
      onClick: () => {
        sceneLocalModelInputRef.current?.click();
      },
    },
    { label: t("ui.ViewportToolbar.label.3c949e02"), icon: Boxes, onClick: toggleModelLibrary },
    { label: t("ui.ViewportToolbar.label.5cbf4958"), icon: Video, onClick: addCameraFromViewport },
    { label: t("ui.ViewportToolbar.label.febda22c"), icon: Ratio, onClick: toggleAspectRatioPanel },
    { label: t("ui.ViewportToolbar.label.fd1429a4"), icon: Camera, onClick: () => void handleCapture("current") },
    { label: t("ui.ViewportToolbar.label.9f87cc9f"), icon: Grid2X2, onClick: () => void handleCapture("four") },
    { label: t("ui.ViewportToolbar.label.ae9c318b"), icon: Grid3X3, onClick: () => void handleCapture("twelve") },
    { label: t("ui.ViewportToolbar.label.93c44f6b"), icon: Expand, onClick: toggleViewportPanelsCollapsed },
  ];

  function renderActionButton(action: ToolbarAction) {
    const Icon = action.icon;
    const active = action.mode ? transformMode === action.mode : false;

    return (
      <button
        key={action.label}
        aria-label={action.label}
        aria-pressed={action.mode ? active : undefined}
        className={`ui-icon-button viewport-toolbar-button${active ? " is-active" : ""}`}
        type="button"
        onClick={action.onClick}
      >
        <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
        <span className="viewport-toolbar-label">{action.label}</span>
      </button>
    );
  }

  const modelLibraryItems = getModelLibraryItems();
  const activeModelLibraryItems =
    activeModelLibraryCategoryId === "my-models"
      ? myModelLibraryItems
      : modelLibraryItems.filter((item) => item.categoryId === activeModelLibraryCategoryId);
  const crowdInputValue = getCrowdInputValue();
  const crowdTotalCount = crowdInputValue.rows * crowdInputValue.columns;

  function setToolbarElement(element: HTMLDivElement | null) {
    toolbarRef.current = element;
    if (toolbarContainerRef) {
      toolbarContainerRef.current = element;
    }
  }

  const aspectRatioPanelStyle = {
    "--viewport-toolbar-height": `${toolbarHeight}px`,
  } as CSSProperties;

  return (
    <>
      <div className="viewport-toolbar" role="group" aria-label={t("ui.ViewportToolbar.arialabel.eec95c3f")} ref={setToolbarElement}>
        {actions.slice(0, 3).map(renderActionButton)}
        <div className="viewport-toolbar-menu-wrap">
          <button
            aria-expanded={characterMenuOpen}
            aria-label={t("ui.ViewportToolbar.arialabel.a02d1c92")}
            className="ui-icon-button viewport-toolbar-button"
            ref={characterTriggerRef}
            type="button"
            onClick={toggleCharacterMenu}
          >
            <UserPlus aria-hidden="true" size={17} strokeWidth={1.9} />
            <span className="viewport-toolbar-label">{t("ui.ViewportToolbar.arialabel.a02d1c92")}</span>
          </button>
        </div>
        {actions.slice(3).map((action) => {
          if (action.onClick !== toggleModelLibrary) {
            return renderActionButton(action);
          }

          const Icon = action.icon;

          return (
            <button
              key={action.label}
              aria-label={action.label}
              className="ui-icon-button viewport-toolbar-button"
              ref={modelLibraryTriggerRef}
              type="button"
              onClick={action.onClick}
            >
              <Icon aria-hidden="true" size={17} strokeWidth={1.9} />
              <span className="viewport-toolbar-label">{action.label}</span>
            </button>
          );
        })}
      </div>
      {characterMenuOpen ? (
        <div
          ref={characterMenuRef}
          className="viewport-toolbar-menu"
          role="menu"
          aria-label={t("ui.ViewportToolbar.arialabel.2405ba09")}
          style={characterMenuStyle}
        >
          {BODY_TYPE_OPTIONS.map((option) => (
            <button
              key={option.bodyType}
              role="menuitem"
              type="button"
              onClick={() => addCharacterWithBodyType(option.bodyType)}
              onMouseEnter={() => {
                setGeometryMenuOpen(false);
                setCrowdPanelOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
          <div
            className="viewport-toolbar-submenu-wrap"
            onMouseEnter={openCrowdPanel}
          >
            <button
              ref={crowdTriggerRef}
              aria-expanded={crowdPanelOpen}
              aria-haspopup="dialog"
              className="viewport-toolbar-menu-subtrigger"
              role="menuitem"
              type="button"
              onFocus={openCrowdPanel}
              onMouseEnter={openCrowdPanel}
            >
              <span>{t("ui.ViewportToolbar.text.a7145fef")}</span>
              <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          </div>
          <div
            className="viewport-toolbar-submenu-wrap"
            onMouseEnter={() => {
              setGeometryMenuOpen(true);
              setCrowdPanelOpen(false);
            }}
          >
            <button
              ref={geometryTriggerRef}
              aria-expanded={geometryMenuOpen}
              aria-haspopup="menu"
              className="viewport-toolbar-menu-subtrigger"
              role="menuitem"
              type="button"
              onMouseEnter={() => {
                setGeometryMenuOpen(true);
                setCrowdPanelOpen(false);
              }}
            >
              <span>{t("ui.ViewportToolbar.text.b8a728fa")}</span>
              <ChevronRight aria-hidden="true" size={14} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      ) : null}
      {crowdPanelOpen ? (
        <div
          ref={crowdPanelRef}
          className="viewport-toolbar-crowd-panel"
          role="dialog"
          aria-label={t("ui.ViewportToolbar.arialabel.04145dca")}
          style={crowdPanelStyle}
        >
          <div className="viewport-toolbar-crowd-panel-header">
            <h2 className="viewport-toolbar-crowd-panel-title">{t("ui.ViewportToolbar.arialabel.04145dca")}</h2>
            <span className="viewport-toolbar-crowd-panel-count">{t("director.crowdCount", { count: crowdTotalCount })}</span>
          </div>
          <div className="viewport-toolbar-crowd-grid">
            <label className="viewport-toolbar-crowd-field">
              <span>{t("ui.ViewportToolbar.text.579f280b")}</span>
              <input
                className="ui-field"
                aria-label={t("ui.ViewportToolbar.arialabel.e6a12de3")}
                inputMode="numeric"
                type="number"
                min={MIN_CROWD_GRID_SIZE}
                max={MAX_CROWD_GRID_SIZE}
                value={crowdRows}
                onChange={(event) => setCrowdRows(event.currentTarget.value)}
              />
            </label>
            <span className="viewport-toolbar-crowd-separator" aria-hidden="true">
              ×
            </span>
            <label className="viewport-toolbar-crowd-field">
              <span>{t("ui.ViewportToolbar.text.067f80c3")}</span>
              <input
                className="ui-field"
                aria-label={t("ui.ViewportToolbar.arialabel.9f0aadba")}
                inputMode="numeric"
                type="number"
                min={MIN_CROWD_GRID_SIZE}
                max={MAX_CROWD_GRID_SIZE}
                value={crowdColumns}
                onChange={(event) => setCrowdColumns(event.currentTarget.value)}
              />
            </label>
            <label className="viewport-toolbar-crowd-field viewport-toolbar-crowd-field-spacing">
              <span>{t("ui.ViewportToolbar.text.043cefb6")}</span>
              <input
                className="ui-field"
                aria-label={t("ui.ViewportToolbar.arialabel.277c87d0")}
                inputMode="decimal"
                type="number"
                min={MIN_CROWD_SPACING}
                max={MAX_CROWD_SPACING}
                step="0.1"
                value={crowdSpacing}
                onChange={(event) => setCrowdSpacing(event.currentTarget.value)}
              />
            </label>
          </div>
          <div className="viewport-toolbar-crowd-actions">
            <button className="viewport-toolbar-crowd-cancel camera-capture-clear-all" type="button" onClick={closeCrowdPanel}>
              {t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
            <button
              aria-label={t("ui.ViewportToolbar.arialabel.0329ed94")}
              className="viewport-toolbar-crowd-confirm camera-capture-send-all"
              type="button"
              onClick={addCrowd}
            >
              {t("ui.ViewportToolbar.text.94191ce2")}</button>
          </div>
        </div>
      ) : null}
      {geometryMenuOpen ? (
        <div
          ref={geometryMenuRef}
          className="viewport-toolbar-submenu"
          role="menu"
          aria-label={t("ui.ViewportToolbar.arialabel.fbcd80d1")}
          style={geometryMenuStyle}
        >
          {GEOMETRY_PRIMITIVE_OPTIONS.map((option) => (
            <button
              key={option.type}
              role="menuitem"
              type="button"
              onClick={() => addGeometryWithType(option.type)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {modelLibraryOpen ? (
        <div
          ref={modelLibraryPanelRef}
          className="model-library-panel"
          role="dialog"
          aria-label={t("ui.ViewportToolbar.label.3c949e02")}
          style={modelLibraryPanelStyle}
        >
          <div className="model-library-header">
            <h2 className="model-library-title">{t("ui.ViewportToolbar.label.3c949e02")}</h2>
            <button
              aria-label={t("ui.ViewportToolbar.arialabel.c8a40f30")}
              className="top-bar-action-button model-library-close-button"
              type="button"
              onClick={() => setModelLibraryOpen(false)}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          </div>
          <div className="model-library-tabs" role="tablist" aria-label={t("ui.ViewportToolbar.arialabel.7ee375b5")}>
            {MODEL_LIBRARY_CATEGORIES.map((category) => {
              const active = category.id === activeModelLibraryCategoryId;

              return (
                <button
                  key={category.id}
                  aria-selected={active}
                  className={`model-library-tab${active ? " is-active" : ""}`}
                  role="tab"
                  type="button"
                  onClick={() => setActiveModelLibraryCategoryId(category.id)}
                >
                  {category.label}
                </button>
              );
            })}
          </div>
          {activeModelLibraryCategoryId === "my-models" && activeModelLibraryItems.length === 0 ? (
            <div className="model-library-empty-state object-search-empty-state" role="status" aria-label={t("ui.ViewportToolbar.arialabel.04808b6c")}>
              <span className="object-search-empty-icon" data-testid="my-models-empty-icon">
                <Boxes aria-hidden="true" size={16} strokeWidth={1.8} />
              </span>
              <span>{t("ui.ViewportToolbar.arialabel.04808b6c")}</span>
              <button className="top-bar-action-button model-library-empty-action" type="button" onClick={() => void handleMyModelsImport()}>
                {t("ui.ViewportToolbar.text.8d9d8699")}</button>
            </div>
          ) : (
            <div className="model-library-grid" role="list" aria-label={t("ui.ViewportToolbar.arialabel.c271d291")}>
              {activeModelLibraryItems.map((item) => (
                activeModelLibraryCategoryId === "my-models" ? (
                  <div key={item.id} className="model-library-card-wrap">
                    <button
                      aria-label={t("ui.ViewportToolbar.text.99bfe663", { value0: item.name })}
                      className="model-library-card"
                      type="button"
                      onClick={() => {
                        addObjectFromAsset(item.id);
                        setModelLibraryOpen(false);
                      }}
                    >
                      <span className="model-library-thumb" aria-hidden="true">
                        {item.thumbUrl ? (
                          <img
                            alt=""
                            aria-hidden="true"
                            className="model-library-thumb-image"
                            loading="lazy"
                            src={item.thumbUrl}
                          />
                        ) : (
                          <Boxes size={24} strokeWidth={1.6} />
                        )}
                      </span>
                      <span className="model-library-name">{item.name}</span>
                    </button>
                    <button
                      aria-label={t("ui.ViewportToolbar.text.b57d6fe3", { value0: item.name })}
                      className="model-library-card-delete"
                      type="button"
                      onClick={() => {
                        removeImportedAsset(item.id);
                      }}
                    >
                      <Trash2 aria-hidden="true" size={14} strokeWidth={1.9} />
                    </button>
                  </div>
                ) : (
                  <button
                    key={item.id}
                    aria-label={t("ui.ViewportToolbar.text.99bfe663", { value0: item.name })}
                    className="model-library-card"
                    type="button"
                    onClick={() => {
                      addModelLibraryItem(item);
                    }}
                  >
                    <span className="model-library-thumb" aria-hidden="true">
                      {item.thumbUrl ? (
                        <img
                          alt=""
                          aria-hidden="true"
                          className="model-library-thumb-image"
                          loading="lazy"
                          src={item.thumbUrl}
                        />
                      ) : (
                        <Boxes size={24} strokeWidth={1.6} />
                      )}
                    </span>
                    <span className="model-library-name">{item.name}</span>
                  </button>
                )
              ))}
              {activeModelLibraryCategoryId === "my-models" ? (
                <button
                  aria-label={t("ui.ViewportToolbar.text.8d9d8699")}
                  className="model-library-card model-library-import-card"
                  type="button"
                  onClick={() => void handleMyModelsImport()}
                >
                  <span className="model-library-thumb model-library-thumb-import" aria-hidden="true">
                    <Plus size={28} strokeWidth={1.8} />
                  </span>
                  <span className="model-library-name">{t("ui.ViewportToolbar.text.8d9d8699")}</span>
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {aspectRatioPanelOpen ? (
        <div
          ref={aspectRatioPanelRef}
          className="viewport-aspect-panel"
          role="dialog"
          aria-label={t("ui.ViewportToolbar.arialabel.c27f341c")}
          style={aspectRatioPanelStyle}
        >
          <h2 className="viewport-aspect-panel-title">{t("ui.ViewportToolbar.arialabel.c27f341c")}</h2>
          <div className="viewport-aspect-panel-grid" role="group" aria-label={t("ui.ViewportToolbar.arialabel.adaf72be")}>
            {VIEWPORT_ASPECT_RATIO_OPTIONS.map((option) => {
              const active = option.id === viewportAspectRatio;
              const frameClassName = `viewport-aspect-option-frame viewport-aspect-option-frame-${option.id.replace(":", "-")}`;

              return (
                <button
                  key={option.id}
                  aria-pressed={active}
                  className={`viewport-aspect-option${active ? " is-active" : ""}`}
                  type="button"
                  onClick={() => selectAspectRatio(option.id)}
                >
                  <span className={frameClassName} aria-hidden="true" />
                  <span className="viewport-aspect-option-label">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <input
        ref={panoramaInputRef}
        aria-hidden="true"
        className="hidden-file-input"
        tabIndex={-1}
        accept=".jpg,.jpeg,.png,.webp"
        type="file"
        onChange={(event) => void handlePanoramaChange(event)}
      />
      <input
        ref={sceneLocalModelInputRef}
        aria-hidden="true"
        className="hidden-file-input"
        data-testid="scene-local-model-input"
        tabIndex={-1}
        accept=".fbx,.obj"
        type="file"
        onChange={(event) => void handleLocalModelChange(event, true)}
      />
      <input
        ref={libraryLocalModelInputRef}
        aria-hidden="true"
        className="hidden-file-input"
        data-testid="library-local-model-input"
        tabIndex={-1}
        accept=".fbx,.obj"
        multiple
        type="file"
        onChange={(event) => void handleLocalModelChange(event, false)}
      />
    </>
  );
}
