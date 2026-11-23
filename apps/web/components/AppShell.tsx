'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LogoutButton } from '@/components';
import { activeHref, NAV_ITEMS } from '@/lib/nav';

/** Barra lateral + cabecera. En pantallas estrechas la barra se abre con un botón y se cierra al navegar. */
export function AppShell({ who, children }: { who: string | null; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = activeHref(pathname);
  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <div className="shell">
      <nav className={`sidebar${open ? ' open' : ''}`} id="sidebar" aria-label="Principal">
        <Link href="/projects" className="brand">Project OS</Link>
        {NAV_ITEMS.map((it) => (
          <Link key={it.href} href={it.href} className="nav-link" aria-current={active === it.href ? 'page' : undefined}>{it.label}</Link>
        ))}
      </nav>
      <div className="shell-main">
        <header className="topbar">
          <button type="button" className="secondary menu-toggle" aria-controls="sidebar" aria-expanded={open} onClick={() => setOpen((v) => !v)}>Menú</button>
          <span className="who">{who ?? ''}</span>
          <LogoutButton />
        </header>
        {children}
      </div>
    </div>
  );
}
