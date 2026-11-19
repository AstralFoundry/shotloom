import { Button } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';
import { catalogLabel, t } from '@/i18n';
import type { InstalledProviderPlugin, ProviderConnection } from '../../domain/provider/plugins/ProviderPlugins';
import { desktopApi } from '../../services/desktopApi';

/** README is untrusted package content. React escapes all text; raw HTML is never interpreted. */
export function PluginMarkdown({ text, onDocument }: { text: string; onDocument: (path: string) => void }) {
  function inline(line: string): ReactNode[] {
    return line.split(/(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g).map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) {
        const [, label, href] = link;
        if (/^https?:\/\//i.test(href!)) return <a key={index} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
        if (/^(?:\.\/)?[a-zA-Z0-9_./-]+\.md(?:#[\w-]+)?$/.test(href!) && !href!.startsWith('/')) return <Button key={index} type="link" onClick={() => onDocument(href!)}>{label}</Button>;
        return <span key={index}>{label}</span>;
      }
      return part;
    });
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i++]!;
    if (line.startsWith('```')) {
      const code: string[] = [];
      while (i < lines.length && !lines[i]!.startsWith('```')) code.push(lines[i++]!);
      i++;
      blocks.push(<pre key={i}><code>{code.join('\n')}</code></pre>);
    } else if (/^\|.*\|$/.test(line.trim()) && /^\|(?:\s*:?-+:?\s*\|)+$/.test(lines[i]?.trim() || '')) {
      const cells = (row: string) => row.trim().slice(1, -1).split('|').map(cell => cell.trim());
      i++;
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|')) rows.push(cells(lines[i++]!));
      blocks.push(<div className="provider-plugin-table-wrap" key={i}><table><thead><tr>{cells(line).map((cell, n) => <th key={n}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, n) => <tr key={n}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,6}\s/.test(line)) {
      const title = line.replace(/^#+\s*/, '');
      blocks.push(line.startsWith('# ') ? <h2 key={i}>{inline(title)}</h2> : <h3 key={i}>{inline(title)}</h3>);
    } else if (/^\s*[-*]\s/.test(line)) {
      const items = [line.replace(/^\s*[-*]\s+/, '')];
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, ''));
      blocks.push(<ul key={i}>{items.map((item, n) => <li key={n}>{inline(item)}</li>)}</ul>);
    } else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="provider-plugin-markdown">{blocks}</div>;
}

export function ProviderPluginDetails({ plugin, connections }: { plugin: InstalledProviderPlugin; connections: ProviderConnection[] }) {
  const { manifest } = plugin;
  const [document, setDocument] = useState<{ path: string; content: string } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => { setDocument(null); setError(''); }, [manifest.id, manifest.version]);
  async function openDocument(href: string) {
    const path = new URL(href.split('#')[0]!, `https://plugin.invalid/${document?.path || 'README.md'}`).pathname.slice(1);
    setLoading(true); setError('');
    try {
      const result = await desktopApi.providerPlugins.manage('documentation', { id: manifest.id, path });
      setDocument({ path, content: result.content });
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }
  const baseUrls = [...new Set([...manifest.providers.map(provider => provider.baseUrl), ...connections.map(connection => connection.baseUrl || '')].filter(Boolean))];
  return <div className="provider-plugin-details">
    <header><h2>{manifest.name}</h2><p>{manifest.description || t('plugins.protocolDescription')}</p>
      <div className="provider-plugin-detail-meta"><span>v{manifest.version}</span>{manifest.author && <span>{manifest.author}</span>}{manifest.license && <span>{manifest.license}</span>}{manifest.homepage && /^https?:\/\//i.test(manifest.homepage) && <a href={manifest.homepage} target="_blank" rel="noopener noreferrer">{t('plugins.homepage')}</a>}</div>
    </header>
    {(manifest.readme || document) && <section aria-busy={loading}>
      {document && <Button type="link" onClick={() => { setDocument(null); setError(''); }}>{t('plugins.backReadme')}</Button>}
      <PluginMarkdown text={document?.content || manifest.readme || ''} onDocument={path => void openDocument(path)} />
      {error && <p role="alert" className="provider-plugin-error">{error}</p>}
    </section>}
    <section><h3>{t('plugins.protocolIdentity')}</h3><dl>
      <dt>{t('plugins.pluginId')}</dt><dd><code>{manifest.id}</code></dd>
      <dt>{t('plugins.version')}</dt><dd>{manifest.version}</dd>
      <dt>{t('plugins.compatibility')}</dt><dd><code>{manifest.shotloom}</code></dd>
      <dt>{t('plugins.sourceFilter')}</dt><dd><code>{plugin.source}</code></dd>
      <dt>{t('plugins.engine')}</dt><dd>{manifest.engine || (manifest.runtime ? 'module' : 'declarative')}</dd>
      {manifest.category && <><dt>{t('plugins.categories')}</dt><dd>{t(({ textGeneration: 'plugins.text', imageGeneration: 'plugins.image', videoGeneration: 'plugins.video', audioGeneration: 'plugins.audio' } as const)[manifest.category as 'textGeneration'] || 'plugins.protocol')}</dd></>}
      {baseUrls.length > 0 && <><dt>{t('plugins.endpoint')}</dt><dd>{baseUrls.map(url => <code key={url}>{url}<br /></code>)}</dd></>}
      {plugin.digest && <><dt>SHA-256</dt><dd><code>{plugin.digest}</code></dd></>}
    </dl></section>
    <section><h3>{t('plugins.configurationFields')}</h3><div className="provider-plugin-table-wrap"><table><thead><tr><th>{t('plugins.field')}</th><th>{t('plugins.fieldType')}</th><th>{t('plugins.descriptionLabel')}</th></tr></thead><tbody>
      <tr><td><code>baseUrl</code></td><td>URL</td><td>{t('plugins.endpoint')}</td></tr>
      <tr><td><code>apiKey</code></td><td>secret</td><td>{t('plugins.keyPerConnection')}</td></tr>
    </tbody></table></div></section>
    {Boolean(manifest.capabilities?.length) && <section><h3>{t('pluginActions.menu')}</h3>
      {manifest.capabilities!.map(capability => <div key={capability.id}>
        <h4>{capability.name}</h4><p>{capability.description}</p>
        <dl><dt>{t('plugins.operationId')}</dt><dd>{capability.id}</dd>
          <dt>{t('pluginActions.inputs')}</dt><dd>{capability.inputs.map(slot => `${slot.label} (${slot.type})`).join(' · ')}</dd>
          <dt>{t('pluginActions.outputs')}</dt><dd>{capability.outputs.map(slot => `${slot.label} (${slot.type})`).join(' · ')}</dd></dl>
      </div>)}
    </section>}
    <details className="provider-plugin-advanced"><summary>{t('plugins.requestContract')}</summary>{manifest.protocols.map(operation => {
      const mode = operation.mode;
      const endpoints = [[t('plugins.createEndpoint'), mode.endpoint], [t('plugins.agentEndpoint'), mode.agent?.endpoint], [t('plugins.queryEndpoint'), mode.taskEndpoint], [t('plugins.resultEndpoint'), mode.taskResultEndpoint], [t('plugins.cancelEndpoint'), mode.cancelEndpoint]] as const;
      return <section key={operation.id}><h3>{catalogLabel(mode.label, mode.labelKey)}</h3>{operation.description && <p>{operation.description}</p>}<dl>
        <dt>{t('plugins.operationId')}</dt><dd><code>{operation.id}</code></dd>
        <dt>{t('plugins.authentication')}</dt><dd><code>{mode.auth?.type || t('plugins.unspecified')}{mode.auth?.name ? ` · ${mode.auth.name}` : ''}</code></dd>
        <dt>{t('plugins.lifecycle')}</dt><dd>{t(mode.isAsync ? 'plugins.asynchronous' : 'plugins.synchronous')}</dd>
        {endpoints.filter(([, endpoint]) => endpoint).map(([label, endpoint]) => <div className="provider-plugin-detail-pair" key={label}><dt>{label}</dt><dd><code>{endpoint!.method} {endpoint!.path}</code><small>{endpoint!.scope || 'v1'}</small></dd></div>)}
      </dl>
      {mode.params?.length > 0 && <div className="provider-plugin-table-wrap"><table><thead><tr><th>{t('plugins.field')}</th><th>{t('plugins.fieldType')}</th><th>{t('plugins.required')}</th><th>{t('plugins.defaultValue')}</th><th>{t('plugins.descriptionLabel')}</th></tr></thead><tbody>{mode.params.map(param => <tr key={param.key}><td><code>{param.key}</code></td><td>{param.type}</td><td>{t(param.required ? 'plugins.yes' : 'plugins.no')}</td><td><code>{param.default === undefined ? '—' : JSON.stringify(param.default)}</code></td><td>{catalogLabel(param.label, param.labelKey)}{param.options && <small>{param.options.map(value => String(value)).join(' · ')}</small>}</td></tr>)}</tbody></table></div>}
      <details><summary>{t('plugins.requestContract')}</summary><pre>{JSON.stringify({ request: mode.requestTemplate ?? mode.requestFields, inputs: mode.inputConstraints, outputs: mode.outputConstraints }, null, 2)}</pre></details>
      </section>;
    })}</details>
  </div>;
}
