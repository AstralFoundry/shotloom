export function agentNodeStableAlias(node: { id?: string }): string;

export function agentNodeAliasMaps(nodes?: Array<{ id: string }>): {
  aliasMap: Record<string, string>;
  aliasById: Record<string, string>;
};
