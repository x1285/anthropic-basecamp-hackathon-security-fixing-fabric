// Loads the demo world (the same data as the target UI's seed) into the database and clears the runs.
import { seedWorld } from '@bloodhound/core';
import { audit, clearRuns, saveWorld } from './store';
import { prisma } from './db';

export async function seedDatabase(): Promise<{ projects: number; repos: number; customers: number; envs: number }> {
  const world = seedWorld();
  await saveWorld(world);
  await clearRuns();
  await audit('seed', 'seed', 'world');
  return {
    projects: world.projects.length,
    repos: world.projects.reduce((n, p) => n + p.repos.length, 0),
    customers: world.customers.length,
    envs: world.envs.length,
  };
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
