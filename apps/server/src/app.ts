import { createApp } from './application.js';

// Vercel imports this entrypoint; it manages the HTTP listener itself.
const app = await createApp();
await app.ready();

export default app.server;
