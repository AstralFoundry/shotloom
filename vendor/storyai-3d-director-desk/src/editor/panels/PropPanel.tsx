import { t } from '../../i18n';
import {
  InspectorAxisGroup,
  InspectorColorField,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorTextField,
} from "./InspectorControls";
import { useDirectorStore } from "../store/directorStore";

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

export function PropPanel() {
  const prop = useDirectorStore((state) => {
    const selected = state.project.objects.find((item) => item.id === state.selectedObjectId);
    const selectedAsset = selected?.assetRefId
      ? state.project.assets.find((asset) => asset.id === selected.assetRefId)
      : undefined;

    if (!selected) return undefined;
    if (selected.kind === "prop") return selected;
    if (selectedAsset?.sourceType === "model") return selected;

    return undefined;
  });
  const updateObjectName = useDirectorStore((state) => state.updateObjectName);
  const updateObjectTransform = useDirectorStore((state) => state.updateObjectTransform);
  const updateUniformScale = useDirectorStore((state) => state.updateUniformScale);
  const updateObjectColor = useDirectorStore((state) => state.updateObjectColor);

  if (!prop) return null;

  const propColor = prop.color ?? "#d7e7ff";

  return (
    <InspectorPanel title={t("ui.PropPanel.title.98fd0cbd")} ariaLabel={t("ui.PropPanel.ariaLabel.1f7201f8")} className="prop-inspector">
      <InspectorTextField label={t("ui.CatalogEditorDialogs.text.1be7ae4f")} ariaLabel={t("ui.PropPanel.ariaLabel.38719c99")} value={prop.name} onChange={(value) => updateObjectName(prop.id, value)} />
      <InspectorAxisGroup
        label={t("ui.PropPanel.label.88c34452")}
        axes={[
          {
            axis: "X",
            ariaLabel: t("ui.PropPanel.ariaLabel.7b530753"),
            value: prop.transform.position[0],
            onChange: (value) => updateObjectTransform(prop.id, { position: replaceAxis(prop.transform.position, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: t("ui.PropPanel.ariaLabel.92a80d03"),
            value: prop.transform.position[1],
            onChange: (value) => updateObjectTransform(prop.id, { position: replaceAxis(prop.transform.position, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: t("ui.PropPanel.ariaLabel.d1e4252c"),
            value: prop.transform.position[2],
            onChange: (value) => updateObjectTransform(prop.id, { position: replaceAxis(prop.transform.position, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label={t("ui.ImageWatermarkEditor.label.a69e51e5")}
        axes={[
          {
            axis: "X",
            ariaLabel: t("ui.PropPanel.ariaLabel.3830332b"),
            value: prop.transform.rotation[0],
            onChange: (value) => updateObjectTransform(prop.id, { rotation: replaceAxis(prop.transform.rotation, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: t("ui.PropPanel.ariaLabel.81f42514"),
            value: prop.transform.rotation[1],
            onChange: (value) => updateObjectTransform(prop.id, { rotation: replaceAxis(prop.transform.rotation, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: t("ui.PropPanel.ariaLabel.f023dee7"),
            value: prop.transform.rotation[2],
            onChange: (value) => updateObjectTransform(prop.id, { rotation: replaceAxis(prop.transform.rotation, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label={t("ui.ViewportToolbar.label.12e2ed4d")}
        axes={[
          {
            axis: "X",
            ariaLabel: t("ui.PropPanel.ariaLabel.b3d5fbc5"),
            step: "0.01",
            value: prop.transform.scale[0],
            onChange: (value) => updateObjectTransform(prop.id, { scale: replaceAxis(prop.transform.scale, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: t("ui.PropPanel.ariaLabel.8eef383a"),
            step: "0.01",
            value: prop.transform.scale[1],
            onChange: (value) => updateObjectTransform(prop.id, { scale: replaceAxis(prop.transform.scale, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: t("ui.PropPanel.ariaLabel.8390de5b"),
            step: "0.01",
            value: prop.transform.scale[2],
            onChange: (value) => updateObjectTransform(prop.id, { scale: replaceAxis(prop.transform.scale, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorRangeNumberField
        label={t("ui.PropPanel.label.e1c2fa74")}
        rangeAriaLabel={t("ui.PropPanel.rangeAriaLabel.065ca4a3")}
        numberAriaLabel={t("ui.PropPanel.numberAriaLabel.50ef7f13")}
        max="3"
        min="0.2"
        step="0.01"
        value={prop.transform.scale[0]}
        onValueChange={(value) => updateUniformScale(prop.id, Number(value))}
      />
      <InspectorColorField
        label={t("ui.ImageWatermarkEditor.text.8ef48860")}
        colorAriaLabel={t("ui.PropPanel.colorAriaLabel.b8903a23")}
        hexAriaLabel={t("ui.PropPanel.hexAriaLabel.74c35489")}
        value={propColor}
        onColorChange={(value) => updateObjectColor(prop.id, value)}
        onHexChange={(value) => updateObjectColor(prop.id, value)}
      />
    </InspectorPanel>
  );
}
