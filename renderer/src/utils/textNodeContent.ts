export function selectedTextOutput(node: any) {
  const outputs = Array.isArray(node?.generatedOutputs) ? node.generatedOutputs : [];
  return outputs.find((output: any) => output?.selected) || outputs[0] || null;
}

export function textNodeContent(node: any): string {
  const output = selectedTextOutput(node);
  return String(output?.content ?? node?.textContent ?? '');
}
