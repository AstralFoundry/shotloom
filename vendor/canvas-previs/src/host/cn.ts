/**
 * Class name joiner. Tailwind users pass conflicting utilities; the last one has to win,
 * so known conflict groups are resolved instead of concatenated.
 */
const CONFLICT_GROUPS: RegExp[] = [
    /^(?:-?m[trblxy]?|p[trblxy]?|gap(?:-[xy])?|space-[xy])-/,
    /^(?:w|h|min-w|min-h|max-w|max-h|size)-/,
    /^(?:text|font|leading|tracking)-/,
    /^(?:bg|border|ring|outline|shadow|rounded)-/,
    /^(?:flex|grid|items|justify|content|self|place)-/,
    /^(?:absolute|relative|fixed|sticky|static|inset|top|right|bottom|left|z)-/,
    /^(?:opacity|transition|duration|ease|animate|translate|rotate|scale)-/,
    /^(?:overflow|truncate|whitespace|break)-/,
];

function groupOf(token: string): number {
    return CONFLICT_GROUPS.findIndex((pattern) => pattern.test(token));
}

export function cn(...values: Array<string | false | null | undefined>): string {
    const kept: string[] = [];
    for (const value of values) {
        if (!value) continue;
        for (const token of String(value).split(/\s+/)) {
            if (!token) continue;
            const group = groupOf(token);
            if (group >= 0) {
                for (let index = kept.length - 1; index >= 0; index -= 1) {
                    if (groupOf(kept[index]) === group) kept.splice(index, 1);
                }
            }
            kept.push(token);
        }
    }
    return kept.join(" ");
}
