/**
 * Contract injection system — cross-cutting rules defined once and
 * automatically injected into the agent system prompt at staging time.
 *
 * Contracts are frontmatter-markdown files in `contracts/` with:
 *   - id: unique contract identifier
 *   - appliesTo: list of agent profile IDs this contract applies to (`*` for all)
 *   - priority: injection order (lower = earlier in the prompt)
 *   - summary: one-line description (for debugging/logging)
 *
 * Skill-specific contracts can be declared in `SKILL.md` frontmatter:
 *   contracts: ['safety-rules', 'narrative-consistency']
 *
 * When a skill is loaded and specifies contracts, only those contracts
 * are injected (plus mode-level contracts that apply to all).
 */

export interface ContractMeta {
  id: string;
  appliesTo: string[];
  priority: number;
  summary: string;
  body: string;
}

// ── Static contract registry ──────────────────────────────────────────
// Contracts are bundled at build time via Vite raw imports.
// Import each contract file here to register it.
const registry = new Map<string, ContractMeta>();

function registerContract(meta: Omit<ContractMeta, 'body'>, body: string): void {
  registry.set(meta.id, { ...meta, body });
}

// ── Built-in contracts ─────────────────────────────────────────────────
// Add new contracts by importing them as raw markdown and parsing frontmatter.

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) return { meta: {}, body: raw };
  const end = trimmed.indexOf('---', 3);
  if (end < 0) return { meta: {}, body: raw };
  const frontmatter = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 3).trim();
  try {
    const lines = frontmatter.split('\n');
    const meta: Record<string, unknown> = {};
    for (const line of lines) {
      const colonIdx = line.indexOf(':');
      if (colonIdx < 0) continue;
      const key = line.slice(0, colonIdx).trim();
      const rawValue = line.slice(colonIdx + 1).trim();

      // Parse YAML-like values
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        meta[key] = rawValue.slice(1, -1).split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      } else if (/^\d+$/.test(rawValue)) {
        meta[key] = Number(rawValue);
      } else {
        meta[key] = rawValue.replace(/^['"]|['"]$/g, '');
      }
    }
    return { meta, body };
  } catch {
    return { meta: {}, body: raw };
  }
}

// ── Registration helpers ───────────────────────────────────────────────

export function registerContractFromRaw(raw: string): void {
  const { meta, body } = parseFrontmatter(raw);
  if (!meta.id || !meta.appliesTo) {
    console.warn('[contracts] contract missing id or appliesTo in frontmatter, skipping');
    return;
  }
  registerContract({
    id: String(meta.id),
    appliesTo: Array.isArray(meta.appliesTo) ? meta.appliesTo as string[] : [String(meta.appliesTo)],
    priority: Number(meta.priority) || 500,
    summary: String(meta.summary || meta.id || ''),
  }, body);
}

// ── Loading & querying ─────────────────────────────────────────────────

export function loadContracts(): ContractMeta[] {
  return [...registry.values()].sort((a, b) => a.priority - b.priority);
}

/**
 * Resolve contracts applicable to the given agent profile and optional Skill filter.
 *
 * @param agent — OpenCode agent profile ID
 * @param skillContracts — optional list of contract IDs from the loaded skill's frontmatter
 * @returns sorted list of matching contracts
 */
export function contractsForAgentType(
  agent: string,
  skillContracts?: string[],
): ContractMeta[] {
  const all = loadContracts();

  // If the loaded skill specifies contracts explicitly, prefer those
  // over mode-level matching, plus always include mode-level contracts
  // that apply to all (i.e. have no skill-specific filter).
  const explicitFilter = skillContracts && skillContracts.length > 0
    ? new Set(skillContracts)
    : null;

  return all.filter((c) => {
    if (!c.appliesTo.includes('*') && !c.appliesTo.includes(agent)) return false;
    // If skill has explicit contract filter, only include matched ones
    if (explicitFilter && !explicitFilter.has(c.id)) return false;
    return true;
  });
}

/**
 * Format a list of contracts as an XML-delimited block suitable for
 * injection into the system prompt.
 */
export function formatContractsBlock(contracts: ContractMeta[]): string {
  if (!contracts.length) return '';
  const bodies = contracts.map((c) => c.body).join('\n\n');
  return `<injected-contracts>\n${bodies}\n</injected-contracts>`;
}

// ── Bootstrap built-in contracts ───────────────────────────────────────
import safetyRulesRaw from './contracts/safety-rules.md?raw';
import productionGovernanceRaw from './contracts/production-governance.md?raw';
registerContractFromRaw(safetyRulesRaw);
registerContractFromRaw(productionGovernanceRaw);
