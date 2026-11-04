import { loadState } from '@bloodhound/engine';
import { BloodhoundApp } from './bloodhound-app';

// The state comes from Postgres on every request, so reloads show the current world and runs.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const initial = await loadState();
  return <BloodhoundApp initial={initial} />;
}
