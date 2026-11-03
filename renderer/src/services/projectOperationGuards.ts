type PendingProjectOperation = { project: object; nodeId: string; reason: string };
const guards = new Set<() => PendingProjectOperation | null>();

/** Read live operation ownership; the registry does not copy or persist session state. */
export function registerProjectOperationGuard(read: () => PendingProjectOperation | null) {
  guards.add(read);
  return () => { guards.delete(read); };
}

export function projectOperationBlockReason(project: object, nodeIds?: readonly string[]): string {
  for (const read of guards) {
    const operation = read();
    if (operation?.project === project && (!nodeIds || nodeIds.includes(operation.nodeId))) return operation.reason;
  }
  return "";
}

export function assertProjectOperationIdle(project: object, nodeIds?: readonly string[]) {
  const reason = projectOperationBlockReason(project, nodeIds);
  if (reason) throw new Error(reason);
}
