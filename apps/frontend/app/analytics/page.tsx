"use client";

import { useEffect, useState } from 'react';
import AppShell from '../components/AppShell';
import { analytics, type DashboardData } from '../lib/api';

interface IndustryItem {
  _id: string;
  avgScore: number;
  count: number;
  high: number;
  won: number;
}

interface CostModel {
  _id: string;
  costUSD: number;
  calls: number;
}

interface CostData {
  days: number;
  dailyCosts: { _id: string; costUSD: number; calls: number; cacheHits: number }[];
  byModel: CostModel[];
  byPurpose: { _id: string; costUSD: number; calls: number }[];
  summary: { totalCostUSD: number; totalCalls: number; cacheHitRate: number };
}

interface AuditEntry {
  type: string;
  problem: string;
  actionTaken: string;
  severity: string;
  timestamp: string;
}

export default function AnalyticsPage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [industries, setIndustries] = useState<IndustryItem[]>([]);
  const [costs, setCosts] = useState<CostData | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      analytics.dashboard(),
      analytics.industries(),
      analytics.costs(14),
      analytics.selfImprove(),
    ])
      .then(([dash, ind, cost, audit]) => {
        setDashboard(dash);
        setIndustries(((ind as { data: IndustryItem[] }).data) ?? []);
        setCosts(cost as CostData);
        setAuditLog(((audit as { data: AuditEntry[] }).data) ?? []);
      })
      .catch(err => {
        setError((err as Error).message || 'Failed to load analytics data.');
      })
      .finally(() => setLoading(false));
  }, []);

  const kpis = dashboard?.kpis;
  const costToday = kpis?.aiCostToday ?? 0;
  const totalLeads = kpis?.totalLeads ?? 0;
  const won = kpis?.wonLast30d ?? 0;
  const convRate = totalLeads > 0 ? ((won / totalLeads) * 100).toFixed(1) : '0.0';
  const totalCostUSD = costs?.summary?.totalCostUSD ?? 0;
  const cacheHitRate = costs?.summary?.cacheHitRate ?? 0;

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Performance Analytics</h1>
          <div className="page-subtitle">
            {loading ? 'Loading analytics…' : error
              ? <span style={{ color: 'var(--danger)' }}>{error}</span>
              : `${totalLeads.toLocaleString()} total leads · ${costs?.days ?? 14}d cost window`}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="stat-grid">
        <div className="stat-block">
          <div className="stat-label">Total Leads</div>
          <div className="stat-value orange">{loading ? '…' : totalLeads.toLocaleString()}</div>
          <div className="stat-delta">ALL TIME</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">HIGH Opportunities</div>
          <div className="stat-value">{loading ? '…' : (kpis?.hotQueue ?? 0).toLocaleString()}</div>
          <div className="stat-delta">ACTIVE PIPELINE</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">Conversion Rate</div>
          <div className="stat-value green">{loading ? '…' : `${convRate}%`}</div>
          <div className="stat-delta">WON (30 DAYS)</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">AI Cost Today</div>
          <div className="stat-value blue">{loading ? '…' : `$${costToday.toFixed(4)}`}</div>
          <div className="stat-delta">USD SPENT</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">14-Day AI Cost</div>
          <div className="stat-value">{loading ? '…' : `$${totalCostUSD.toFixed(4)}`}</div>
          <div className="stat-delta">TOTAL SPEND</div>
        </div>
        <div className="stat-block">
          <div className="stat-label">Cache Hit Rate</div>
          <div className="stat-value green">{loading ? '…' : `${(cacheHitRate * 100).toFixed(1)}%`}</div>
          <div className="stat-delta">COST SAVED</div>
        </div>
      </div>

      <div className="grid-2 mt-16">
        {/* Top Industries */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Top Industries by Score</span>
          </div>
          {loading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: '12px 0' }}>Loading…</div>
          ) : industries.length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: '12px 0' }}>
              No industry data yet. Run a search to populate leads.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {industries.slice(0, 8).map(item => (
                <div key={item._id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, letterSpacing: '0.06em' }}>
                      {String(item._id).toUpperCase()}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: "'Share Tech Mono', monospace" }}>
                      {item.count} leads · {item.high} HIGH
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: 'var(--border)', position: 'relative', borderRadius: 2 }}>
                      <div style={{
                        position: 'absolute', left: 0, top: 0, height: '100%',
                        width: `${item.avgScore ?? 0}%`,
                        background: (item.avgScore ?? 0) >= 65
                          ? 'var(--primary)'
                          : (item.avgScore ?? 0) >= 30
                          ? 'var(--warm)'
                          : 'var(--cold)',
                        borderRadius: 2,
                      }} />
                    </div>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--fg-dim)', minWidth: 24, textAlign: 'right' }}>
                      {Math.round(item.avgScore ?? 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Cost by Model */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">AI Cost Breakdown (14 Days)</span>
          </div>
          {loading ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: '12px 0' }}>Loading…</div>
          ) : !costs || (costs.byModel ?? []).length === 0 ? (
            <div style={{ color: 'var(--fg-muted)', fontSize: 11, padding: '12px 0' }}>
              No AI cost data yet. Leads are scored without API calls until enrichment is complete.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(costs.byModel ?? []).filter(m => m?._id).map(m => (
                <div key={m._id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
                      {m._id}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--fg-dim)', fontFamily: "'Share Tech Mono', monospace" }}>
                      {m.calls} calls
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--success)', fontFamily: "'Share Tech Mono', monospace" }}>
                    ${m.costUSD.toFixed(4)}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 4 }}>
                <span style={{ color: 'var(--fg-muted)' }}>TOTAL</span>
                <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--primary)' }}>
                  ${totalCostUSD.toFixed(4)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                <span style={{ color: 'var(--fg-muted)' }}>CACHE HIT RATE</span>
                <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--success)' }}>
                  {(cacheHitRate * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Self-Improvement Audit Log */}
      <div className="panel mt-16">
        <div className="panel-header">
          <span className="panel-title">Self-Improvement Audit Log</span>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>AI optimization events</span>
        </div>
        <div className="console-block">
          {loading ? (
            'Loading…'
          ) : auditLog.length === 0 ? (
            '[INFO]  No optimization events yet. Engine logs scoring adjustments here every 6 hours.'
          ) : (
            auditLog.slice(0, 15).map((entry, i) => {
              const tag =
                entry.severity === 'critical' ? 'CRIT' :
                entry.severity === 'warning'  ? 'WARN' :
                'INFO';
              const color =
                entry.severity === 'critical' ? 'var(--danger)' :
                entry.severity === 'warning'  ? 'var(--warm)' :
                'var(--primary)';
              return (
                <span key={i}>
                  <span style={{ color }}>[{tag}]</span>
                  {'  '}{entry.actionTaken || entry.problem}
                  {entry.timestamp && (
                    <span style={{ color: 'var(--fg-muted)', fontSize: 9 }}>
                      {'  '}{new Date(entry.timestamp).toLocaleString()}
                    </span>
                  )}
                  {'\n'}
                </span>
              );
            })
          )}
        </div>
      </div>
    </AppShell>
  );
}
