import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Bloodhound', description: 'Security incident fixes across repos and environments' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="topbar">
          <strong>Bloodhound</strong>
          <nav>
            <a href="/">Dashboard</a>
            <a href="/inbox">Freigaben</a>
            <a href="/outbox">Outbox</a>
            <a href="/lab">Demo-Lab</a>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
