"use client";

import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { settings, analytics, type ScoringConfig } from '../lib/api';


export default function OptimizerPage() {
  const [config, setConfig] = useState<ScoringConfig | null>(null);
  const [auditLog, setAuditLog] = useState<{ message: string; type: string; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      settings.activeScoringConfig(),
      analytics.selfImprove(),
    ]).then(([cfg, audit]) => {
      setConfig(cfg as unknown as ScoringConfig);
      setAuditLog((audit as { data: { message: string; type: string; createdAt: string }[] }).data ?? []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const weights = config?.weights ?? {};
  const weightEntries = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  const totalWeight = weightEntries.reduce((s, [, v]) => s + v, 0);

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">AI Engine Optimizer</h1>
          <div className="page-subtitle">Active scoring weights for HydraFox Lead Scorer</div>
        </div>
      </div>

      <div className="panel mb-24">
        <div className="panel-header">
          <span className="panel-title">
            Active Scoring Strategy: V{loading ? '…' : config?.version ?? 1}
          </span>
          <span className="badge badge-won">ACTIVE</span>
        </div>

        {loading ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>Loading config…</div>
        ) : weightEntries.length === 0 ? (
          <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>No scoring weights found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {weightEntries.map(([label, weight]) => (
              <div key={label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 4 }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
                  <span className="data">{weight} / {totalWeight}</span>
                </div>
                <div style={{ height: 4, background: 'var(--border)', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, height: '100%',
                    width: `${totalWeight > 0 ? (weight / totalWeight) * 100 : 0}%`,
                    background: 'var(--primary)'
                  }} />
                </div>
              </div>
            ))}
            {config?.notes && (
              <div style={{ fontSize: 10, color: 'var(--fg-muted)', marginTop: 8 }}>NOTE: {config.notes}</div>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Optimization Log</span>
        </div>
        <div className="console-block">
          {loading ? (
            'Loading…'
          ) : auditLog.length === 0 ? (
            'No optimization events yet. Engine will log scoring adjustments here.'
          ) : (
            auditLog.slice(0, 10).map((entry, i) => (
              <span key={i}>
                <span className={entry.type === 'warn' ? 'warn' : entry.type === 'success' ? 'success' : 'info'}>
                  [{entry.type?.toUpperCase() ?? 'INFO'}]
                </span>{' '}
                {entry.message}{'\n'}
              </span>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}
