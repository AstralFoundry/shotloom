export function selectedTextOutput(node) {
  const outputs = Array.isArray(node?.generatedOutputs) ? node.generatedOutputs : [];
  return outputs.find((output) => output?.selected) || outputs[0] || null;
}

export function textNodeContent(node) {
  const output = selectedTextOutput(node);
  return String(output?.content ?? node?.textContent ?? '');
}
