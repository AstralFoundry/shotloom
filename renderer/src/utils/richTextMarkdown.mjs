const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

function inlineMarkdown(value = '') {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>');
}

export function markdownToRichHtml(markdown = '') {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const tableDivider = lines[index + 1] || '';
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|(?:\s*:?-+:?\s*\|)+\s*$/.test(tableDivider)) {
      const rows = [];
      const cells = (value) => value.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      rows.push(`<thead><tr>${cells(line).map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead>`);
      index += 2;
      const body = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        body.push(`<tr>${cells(lines[index]).map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`);
        index += 1;
      }
      html.push(`<table>${rows.join('')}<tbody>${body.join('')}</tbody></table>`);
      continue;
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const tag = unordered ? 'ul' : 'ol';
      const items = [];
      while (index < lines.length) {
        const match = tag === 'ul'
          ? /^\s*[-*]\s+(.+)$/.exec(lines[index])
          : /^\s*\d+\.\s+(.+)$/.exec(lines[index]);
        if (!match) break;
        items.push(`<li>${inlineMarkdown(match[1])}</li>`);
        index += 1;
      }
      html.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) html.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
    else if (/^\s*---+\s*$/.test(line)) html.push('<hr>');
    else if (line.trim()) html.push(`<p>${inlineMarkdown(line)}</p>`);
    else html.push('<p><br></p>');
    index += 1;
  }
  return html.join('');
}

const inlineToMarkdown = (node) => {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const tag = node.tagName.toLowerCase();
  const content = [...node.childNodes].map(inlineToMarkdown).join('');
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
  const blocks = [];
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
          `| ${rows[0].join(' | ')} |`,
          `| ${rows[0].map(() => '---').join(' | ')} |`,
          ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
        ].join('\n'));
      }
    } else blocks.push(inlineToMarkdown(node));
  }
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
