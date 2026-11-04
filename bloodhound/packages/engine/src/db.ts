import './paths';
import { PrismaClient } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __bloodhoundPrisma: PrismaClient | undefined;
}

export const prisma = globalThis.__bloodhoundPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalThis.__bloodhoundPrisma = prisma;

/** Feature flags and config defaults live in the Flag table (seeded). */
export async function flag<T extends boolean | number>(name: string, fallback: T): Promise<T> {
  const row = await prisma.flag.findUnique({ where: { name } });
  if (!row) return fallback;
  return row.enabled as T;
}

export async function audit(actor: string, action: string, target: string, detail: object = {}): Promise<void> {
  await prisma.auditLog.create({ data: { actor, action, target, detail: detail as object } });
}
