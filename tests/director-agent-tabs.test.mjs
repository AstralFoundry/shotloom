import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('director tabs keep both panels mounted and expose only the selected panel', async () => {
  const env = await createRendererEnv({ plugins: [{
    name: 'director-chat-boundary',
    enforce: 'pre',
    load(id) {
      if (id.replaceAll('\\', '/').endsWith('/agent-chat/HarnessChatPanel.tsx')) {
        return `import { createElement } from 'react';
          export function HarnessChatPanel(props) {
            return createElement('section', { 'data-chat-node': props.nodeId, 'data-chat-agent': props.agentId, 'data-chat-mode': props.directorMode });
          }`;
      }
    },
  }] });
  try {
    const { DirectorAgentPane } = await env.load('app/agent-chat/DirectorAgentPane.tsx');
    for (const collapsed of [true, false]) {
      const markup = renderToStaticMarkup(createElement(DirectorAgentPane, {
        className: 'director-workspace-agent', nodeId: 'director-1', collapsed, onCollapsedChange() {},
      }, createElement('iframe', { src: 'director-scene', title: 'scene' })));
      assert.equal((markup.match(/type="radio"/g) || []).length, 2);
      assert.equal((markup.match(/checked=""/g) || []).length, 1);
      assert.equal((markup.match(/role="region"/g) || []).length, 2);
      assert.equal((markup.match(/inert=""/g) || []).length, 1);
      assert.match(markup, new RegExp(`role="region"[^>]*aria-label="导演台"[^>]*aria-hidden="${!collapsed}"`));
      assert.match(markup, new RegExp(`role="region"[^>]*aria-label="Agent 聊天"[^>]*aria-hidden="${collapsed}"`));
      assert.match(markup, /<iframe[^>]*src="director-scene"/);
      assert.match(markup, /data-chat-node="director-1"/);
      assert.match(markup, /data-chat-agent="director-primary"/);
      assert.doesNotMatch(markup, /data-chat-mode=/, 'chat uses the full conversation UI');
    }
    const workspace = renderToStaticMarkup(createElement(DirectorAgentPane, {
      className: 'director-workspace-agent', collapsed: false, onCollapsedChange() {},
    }));
    assert.match(workspace, /data-chat-agent="canvas-primary"/, 'workspace continues the canvas conversation');
  } finally { await env.dispose(); }
});
