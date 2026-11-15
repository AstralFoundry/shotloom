async function request(path, context, body) {
  const response = await fetch(context.config.baseUrl + path, { method: body ? 'POST' : 'GET', signal: context.signal, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Service returned HTTP ${response.status}`);
  return response.json();
}
export const submit = (input, context) => request('/tasks', context, { prompt: input.prompt, submissionId: input.submissionId });
export const poll = (input, context) => request(`/tasks/${encodeURIComponent(input.remoteTaskId)}`, context);
export const cancel = (input, context) => request(`/tasks/${encodeURIComponent(input.remoteTaskId)}/cancel`, context, {});
export const models = (_input, context) => request('/models', context);
