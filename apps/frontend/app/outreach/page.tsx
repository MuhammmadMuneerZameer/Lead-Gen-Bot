"use client";

import AppShell from '../components/AppShell';

export default function OutreachPage() {
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Outreach Live Feed</h1>
          <div className="page-subtitle">Real-time monitoring of all outgoing and incoming communications</div>
        </div>
      </div>

      <div className="panel" style={{ textAlign: 'center', padding: '64px 32px' }}>
        <div style={{ fontSize: 32, marginBottom: 16, color: 'var(--fg-muted)' }}>◈</div>
        <div style={{ fontSize: 14, color: 'var(--fg)', marginBottom: 8, letterSpacing: '0.1em' }}>NO OUTREACH ACTIVITY YET</div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', maxWidth: 400, margin: '0 auto' }}>
          Messages sent, replies, and status updates will appear here once the outreach engine starts processing leads.
        </div>
      </div>
    </AppShell>
  );
}
