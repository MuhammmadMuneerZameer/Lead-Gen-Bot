"use client";

import AppShell from '../components/AppShell';

export default function CampaignsPage() {
  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Outreach Campaigns</h1>
          <div className="page-subtitle">Manage and monitor your automated lead sequences</div>
        </div>
      </div>

      <div className="panel" style={{ textAlign: 'center', padding: '64px 32px' }}>
        <div style={{ fontSize: 32, marginBottom: 16, color: 'var(--fg-muted)' }}>◈</div>
        <div style={{ fontSize: 14, color: 'var(--fg)', marginBottom: 8, letterSpacing: '0.1em' }}>NO CAMPAIGNS YET</div>
        <div style={{ fontSize: 11, color: 'var(--fg-muted)', maxWidth: 400, margin: '0 auto' }}>
          Campaigns will appear here once leads are enriched and outreach sequences are triggered by the engine.
        </div>
      </div>
    </AppShell>
  );
}
