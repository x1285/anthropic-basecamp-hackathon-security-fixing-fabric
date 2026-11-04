import { seed } from '../packages/engine/src/seed.js';
import { prisma } from '../packages/engine/src/db.js';

const counts = await seed();
console.log(`seeded: ${JSON.stringify(counts)}`);
await prisma.$disconnect();
