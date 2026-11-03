const escapeHtml = (value: unknown = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

function inlineMarkdown(value: unknown = '') {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

export function markdownToRichHtml(markdown: unknown = '') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const html: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] as string;
    const tableDivider = lines[index + 1] || '';
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(tableDivider)) {
      const rows: string[] = [];
      const cells = (value: string) => value.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      rows.push(`<thead><tr>${cells(line).map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`);
      index += 2;
      const body: string[] = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index] as string)) {
        body.push(`<tr>${cells(lines[index] as string).map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`);
        index += 1;
      }
      html.push(`<table>${rows.join('')}<tbody>${body.join('')}</tbody></table>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const tag = unordered ? 'ul' : 'ol';
      const items: string[] = [];
      while (index < lines.length) {
        const match = tag === 'ul'
          ? /^\s*[-*]\s+(.+)$/.exec(lines[index] as string)
          : /^\s*\d+\.\s+(.+)$/.exec(lines[index] as string);
        if (!match) break;
        items.push(`<li>${inlineMarkdown(match[1] as string)}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) html.push(`<h${(heading[1] as string).length}>${inlineMarkdown(heading[2])}</h${(heading[1] as string).length}>`);
    else if (/^\s*---+\s*$/.test(line)) html.push('<hr>');
    else if (line.trim()) html.push(`<p>${inlineMarkdown(line)}</p>`);
    else html.push('<p><br></p>');
    index += 1;
  }
  return html.join('');
}

const inlineToMarkdown = (node: Node): string => {
  if (node.nodeType === 3) return (node as Text).nodeValue || '';
  if (node.nodeType !== 1) return '';
  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const content = [...element.childNodes].map(inlineToMarkdown).join('');
  if (tag === 'strong' || tag === 'b') return `**${content}**`;
  if (tag === 'em' || tag === 'i') return `_${content}_`;
  if (tag === 'code') return `\`${content}\``;
  if (tag === 'br') return '\n';
  return content;
};

export function richHtmlToMarkdown(html = '') {
  if (typeof DOMParser === 'undefined') return String(html);
  const document = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  const root = document.querySelector('main');
  const blocks: string[] = [];
  for (const node of root?.children || []) {
    const tag = node.tagName.toLowerCase();
    if (/^h[1-3]$/.test(tag)) blocks.push(`${'#'.repeat(Number(tag[1]))} ${inlineToMarkdown(node)}`);
    else if (tag === 'p' || tag === 'div') blocks.push(inlineToMarkdown(node));
    else if (tag === 'hr') blocks.push('---');
    else if (tag === 'ul' || tag === 'ol') {
      blocks.push([...node.children].map((item, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${inlineToMarkdown(item)}`).join('\n'));
    } else if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => inlineToMarkdown(cell).trim()));
      if (rows.length) {
        blocks.push([
          `| ${(rows[0] as string[]).join(' | ')} |`,
          `| ${(rows[0] as string[]).map(() => '---').join(' | ')} |`,
          ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
        ].join('\n'));
      }
    } else blocks.push(inlineToMarkdown(node));
  }
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
