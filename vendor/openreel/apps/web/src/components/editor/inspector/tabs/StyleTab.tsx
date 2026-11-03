import { editorMessage } from "../../../../shotloom-mode";
import React from "react";
import { TextSection, ShapeSection, SVGSection } from "../";
import { InspectorSection } from "../shell/InspectorSection";

export interface StyleTabProps {
  clipId: string;
  showTextSection: boolean;
  showShapeSection: boolean;
  showSVGSection: boolean;
}

export const StyleTab: React.FC<StyleTabProps> = ({
  clipId,
  showTextSection,
  showShapeSection,
  showSVGSection,
}) => {
  return (
    <>
      {showTextSection && (
        <InspectorSection title={editorMessage("editor.inspectorSections.text")} sectionId="text-properties">
          <TextSection clipId={clipId} />
        </InspectorSection>
      )}
      {showShapeSection && (
        <InspectorSection title={editorMessage("editor.inspectorSections.shape")} sectionId="shape-properties">
          <ShapeSection clipId={clipId} />
        </InspectorSection>
      )}
      {showSVGSection && (
        <InspectorSection title={editorMessage("editor.inspectorSections.svg")}>
          <SVGSection clipId={clipId} />
        </InspectorSection>
      )}
    </>
  );
};
