// -----------------------------------------------------------------------------
// Entry point of the Zaptec integration for Gladys Assistant.
//
// SDK wiring only: the Gladys client is created here and handed to the app
// (src/app.js), which registers every handler BEFORE connect(). The tests run
// the same app against the SDK's fake Gladys.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR
//     (read by the SDK);
//   - TZ, the time zone of Gladys; LOG_LEVEL=debug shows every reading.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createApp } from './src/app.js';
import { createZaptecClient } from './src/zaptec/client.js';
import { createTokenStore } from './src/store.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const gladys = new GladysIntegration();
const tokenStore = createTokenStore();

const app = createApp({
  gladys,
  logger,
  createClient: (config) =>
    createZaptecClient({
      username: config.username,
      password: config.password,
      tokenStore,
      userAgent: `gladys-zaptec/${version}`,
    }),
});
app.register();

// The SDK disconnects cleanly and exits with code 0 when the supervisor stops
// the container (SIGTERM/SIGINT).
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}: stopping`);
  app.stop();
});

logger.info(`Starting the Zaptec integration ${version}`);
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
