import type { ReactNode } from 'react';
import { Brand } from './brand';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth-layout">
      <aside className="auth-story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">
            <span className="status-dot" /> YOUR PHARMACY, CONNECTED
          </span>
          <h1>
            Good care starts
            <br />
            with a strong
            <br />
            <em>connection.</em>
          </h1>
          <p>
            Your pharmacy&apos;s next chapter starts here.
            <br className="desktop-break" /> One secure account. A connected supply chain.
          </p>
        </div>
        <div className="pharmacy-illustration" aria-hidden="true">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="illustration-node node-left">✚</div>
          <div className="illustration-node node-right">↗</div>
          <div className="pharmacy-building">
            <div className="building-sign">
              ✚ <span>YOUR PHARMACY</span>
            </div>
            <div className="building-awning" />
            <div className="building-front">
              <div className="building-window">
                <i />
                <i />
                <i />
              </div>
              <div className="building-door" />
            </div>
          </div>
          <span className="illustration-caption">BETTER CONNECTED. BETTER PREPARED.</span>
        </div>
        <p className="story-footer">Built around the people who care for others.</p>
      </aside>
      <section className="auth-panel">
        <div className="mobile-brand">
          <Brand />
        </div>
        {children}
        <footer className="auth-footer">
          <span aria-hidden="true">◈</span> Secure access for your pharmacy
        </footer>
      </section>
    </main>
  );
}
