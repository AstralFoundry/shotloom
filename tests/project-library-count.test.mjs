import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('folder cards count the entries shown inside the folder after library updates', async () => {
  const env = await createRendererEnv();
  try {
    const { ProjectsView } = await env.load('app/views/ProjectsView.tsx');
    const { formatItemCount } = await env.load('utils/format');
    const project = { kind: 'project', name: 'Canvas', projectDir: '/folder/canvas', filePath: '/folder/canvas/project.sqlite' };
    const nested = { kind: 'folder', name: 'Nested', folderDir: '/folder/nested', children: [project] };
    for (const children of [[project], [project, nested], []]) {
      const folder = { kind: 'folder', name: 'Folder', folderDir: '/folder', children };
      const markup = renderToStaticMarkup(createElement(ProjectsView, { entries: [folder], controller: {} }));
      assert.ok(markup.includes(`${formatItemCount(children.length)} ·`), `Expected ${children.length} items on folder card`);
    }
  } finally { await env.dispose(); }
});
