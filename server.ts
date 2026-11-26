import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './src/server/db.ts';
import { evaluateAndDispatchCriticalAlerts } from './src/server/criticalAlertService.ts';
import { apiRouter } from './src/server/routes.ts';

async function startServer() {
  initDatabase();

  // Periodic background monitor for weekend/off-hours critical stock breaches
  setTimeout(() => {
    void evaluateAndDispatchCriticalAlerts().catch((err) => {
      console.error('Initial critical alert monitor check failed:', err);
    });
  }, 3000).unref();

  const alertMonitorInterval = setInterval(() => {
    void evaluateAndDispatchCriticalAlerts().catch((err) => {
      console.error('Critical alert monitor check failed:', err);
    });
  }, 60_000);
  alertMonitorInterval.unref();

  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  const isProd = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distPath)) {
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      plugins: hmrDisabled
        ? [
            {
              name: 'disable-vite-client-ws-when-hmr-off',
              enforce: 'post',
              transform(code: string, id: string) {
                if (
                  id.endsWith('/dist/client/client.mjs') ||
                  id.endsWith('\\dist\\client\\client.mjs')
                ) {
                  const startMarker = 'const transport = normalizeModuleRunnerTransport((() => {';
                  const endMarker = 'let willUnload = false;';
                  const startIdx = code.indexOf(startMarker);
                  const endIdx = code.indexOf(endMarker);
                  if (startIdx !== -1 && endIdx > startIdx) {
                    const noopTransport =
                      'const transport = normalizeModuleRunnerTransport({ connect() {}, disconnect() {}, send() {} });';
                    return {
                      code: code.slice(0, startIdx) + noopTransport + code.slice(endIdx),
                      map: null,
                    };
                  }
                }
                return undefined;
              },
            },
          ]
        : [],
      server: {
        middlewareMode: true,
        hmr: hmrDisabled ? false : { server: httpServer },
        ws: hmrDisabled ? false : { server: httpServer },
        watch: hmrDisabled ? null : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = isProd ? Number(process.env.PORT) || 3000 : 3000;
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Printshop POS server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Printshop POS server:', err);
  process.exit(1);
});
