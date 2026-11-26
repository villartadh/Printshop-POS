import express from 'express';
import { apiErrorHandler } from './httpUtils.ts';
import { apiRouter } from './routes.ts';

export function createApiApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api', apiRouter);

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use(apiErrorHandler);
  return app;
}
