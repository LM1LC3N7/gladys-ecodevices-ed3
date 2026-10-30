// -----------------------------------------------------------------------------
// Entry point: SDK wiring only (src/handlers.js registers every handler BEFORE
// connect(), and delegates to the Ed3Hub of src/hub.js: one Ed3App of
// src/app.js per Eco-Devices 3 of the configuration).
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { Ed3Hub } from './src/hub.js';
import { registerHandlers } from './src/handlers.js';

const gladys = new GladysIntegration();
const app = new Ed3Hub({ gladys });

registerHandlers(gladys, app, logger);
// The timers stop and /data is written on the way out.
gladys.handleShutdown(() => app.shutdown());

logger.info('Starting the Eco-Devices 3 integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
