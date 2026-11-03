import ts from "typescript";
import path from "node:path";
import type { Plugin } from "vite";

/** Adapt vendor viewport geometry at its build boundary, without patching browser prototypes. */
export function embeddedCoordinatesPlugin(enabled: boolean): Plugin {
  const helper = path.resolve(import.meta.dirname, "../src/embedded/layout.ts");
  return {
    name: "openreel-embedded-coordinates", enforce: "pre",
    transform(code, id) {
      if (!enabled || !/\/apps\/web\/src\/.+\.[tj]sx?$/.test(id) || id.includes("/embedded/") || id.endsWith("/shotloom-mode.ts")) return;
      if (!/getBoundingClientRect|\.client[XY]\b/.test(code)) return;
      const file = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, id.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      let changed = false;
      const result = ts.transform(file, [context => {
        const visit: ts.Visitor = node => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "getBoundingClientRect" && !node.expression.questionDotToken && node.arguments.length === 0) {
            changed = true;
            return ts.factory.createCallExpression(ts.factory.createIdentifier("__clipRect"), undefined, [ts.visitNode(node.expression.expression, visit) as ts.Expression]);
          }
          if (ts.isPropertyAccessExpression(node) && !node.questionDotToken && (node.name.text === "clientX" || node.name.text === "clientY")) {
            changed = true;
            return ts.factory.createCallExpression(ts.factory.createIdentifier(node.name.text === "clientX" ? "__clipX" : "__clipY"), undefined, [ts.visitNode(node.expression, visit) as ts.Expression]);
          }
          return ts.visitEachChild(node, visit, context);
        };
        return source => ts.visitNode(source, visit) as ts.SourceFile;
      }]);
      const output = ts.createPrinter().printFile(result.transformed[0] as ts.SourceFile);
      result.dispose();
      return changed ? `import {getEditorLocalRect as __clipRect,getEditorClientX as __clipX,getEditorClientY as __clipY} from ${JSON.stringify(helper)};\n${output}` : undefined;
    },
  };
}
