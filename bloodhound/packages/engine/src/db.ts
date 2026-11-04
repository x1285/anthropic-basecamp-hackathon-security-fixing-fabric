// One PrismaClient per process (Next.js dev mode reloads modules, so keep it on globalThis).
import { PrismaClient } from '@prisma/client';

const g = globalThis as unknown as { __bloodhoundPrisma?: PrismaClient };

export const prisma: PrismaClient = g.__bloodhoundPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.__bloodhoundPrisma = prisma;
