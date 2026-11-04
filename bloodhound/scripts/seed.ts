// Loads the demo world into the database (dev or test, depending on DATABASE_URL).
import { disconnect, seedDatabase } from '../packages/engine/src/index';

const counts = await seedDatabase();
console.log(`seeded: ${JSON.stringify(counts)}`);
await disconnect();
