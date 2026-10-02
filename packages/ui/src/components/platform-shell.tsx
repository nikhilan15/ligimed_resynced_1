import type { ReactNode } from 'react';

export interface PlatformShellProps {
  applicationName: string;
  description: string;
  children?: ReactNode;
}

export function PlatformShell({ applicationName, description, children }: PlatformShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div aria-hidden="true" className="h-9 w-9 rounded-lg bg-blue-700" />
            <div>
              <p className="font-bold tracking-tight">LigiMed</p>
              <p className="text-xs text-slate-500">{applicationName}</p>
            </div>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900">
            Phase 0 foundation
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-blue-700">
            Foundation environment
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight">{applicationName}</h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">{description}</p>
          {children ? <div className="mt-8">{children}</div> : null}
        </section>
      </main>
    </div>
  );
}
