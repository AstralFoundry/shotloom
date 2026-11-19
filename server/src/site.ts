import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';

export function createSiteApp(directory: string) {
  const site = new Hono();
  if (!existsSync(directory)) return site;
  const root = relative(process.cwd(), directory).replace(/\\/g, '/');
  site.use('/*', async (c, next) => {
    // Stable HTML and runtime URLs must revalidate after a deployment.
    if (!c.req.path.startsWith('/api/')) c.header('Cache-Control', 'no-cache');
    await next();
  });
  site.get('/', (c, next) => {
    // Keep existing project links, OAuth recovery and native handoffs on the workspace.
    const query = new URL(c.req.url).searchParams;
    if (['native', 'project', 'route', 'folder', 'panel', 'auth'].some(key => query.has(key))) {
      return serveStatic({ root, path: 'index.html' })(c, next);
    }
    return serveStatic({ root, path: 'home.html' })(c, next);
  });
  site.get('/download', serveStatic({ root, path: 'download.html' }));
  site.get('/payment/return', serveStatic({ root, path: 'payment-return.html' }));
  site.get('/app', serveStatic({ root, path: 'index.html' }));
  site.get('/download/', c => c.redirect(`/download${new URL(c.req.url).search}`, 308));
  site.get('/app/', c => c.redirect(`/app${new URL(c.req.url).search}`, 308));
  site.get('/*', serveStatic({ root }));
  site.get('/*', (c, next) => {
    if (c.req.path.startsWith('/api/') || !c.req.header('accept')?.includes('text/html')) return next();
    return serveStatic({ root, path: 'index.html' })(c, next);
  });
  return site;
}
