import type { Request, Response } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/lib/config.js';
import { initDb, getDefaultDbPath } from '../src/db/index.js';
import { initPostgres } from '../src/db/postgres.js';

let appPromise: Promise<any> | null = null;

async function bootstrapApp() {
  const config = loadConfig();
  const db = initDb(getDefaultDbPath());
  await initPostgres(db);
  return createApp(config);
}

export default async function handler(req: Request, res: Response) {
  if (!appPromise) {
    appPromise = bootstrapApp();
  }
  const app = await appPromise;
  return app(req, res);
}

