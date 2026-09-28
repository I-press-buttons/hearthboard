import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { app } = await buildApp(config, { logger: true });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `Hearthboard is up on port ${config.port} (data: ${config.dataDir}, photos: ${config.photosDir}${config.demo ? ', DEMO MODE' : ''})`,
);
