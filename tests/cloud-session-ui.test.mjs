import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('checking an existing cloud session shows a compact loading state without the login form', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  globalThis.location = { search: '' };
  try {
    const { CloudSession } = await env.load('app/CloudSession.tsx');
    const html = renderToStaticMarkup(createElement(CloudSession, null, 'workspace'));
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /cloud-login-card|<form|workspace/);
  } finally { delete globalThis.location; await env.dispose(); }
});

test('OAuth login carries the current workspace URL through the server redirect', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  window.location = { href: 'https://shotloom.example/?route=tasks&project=demo#canvas' };
  try {
    const { SocialAuth } = await env.load('app/components/SocialAuth.tsx');
    const html = renderToStaticMarkup(createElement(SocialAuth));
    assert.match(html, /name="redirect"/);
    assert.match(html, /value="https:\/\/shotloom.example\/\?route=tasks&amp;project=demo#canvas"/);
  } finally { await env.dispose(); }
});
