import { loadConfig } from './config';
import { dropPrivileges } from './privileges';

const config = loadConfig();
// The database holds password hashes and tokens: keep new files away from other NAS accounts.
process.umask(0o077);
const runningAs = dropPrivileges(config.dataDir);

// Import the app only after switching user, so every file is created as that user.
const { buildApp } = await import('./app');
const { app } = await buildApp(config, { logger: true });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Hearthboard is up on port ${config.port} (data: ${config.dataDir}, photos: ${config.photosDir}` +
    `${runningAs ? `, user ${runningAs}` : ''}${config.demo ? ', DEMO MODE' : ''})`,
);
