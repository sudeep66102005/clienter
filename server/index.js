import { createDatabase } from './db.js';
import { createApp } from './app.js';
const db = await createDatabase();
const app = createApp(db);
const server = app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`Clienter listening on ${process.env.PORT || 3000}`));
process.on('SIGTERM', () => server.close(async () => { await db.end(); process.exit(0); }));
