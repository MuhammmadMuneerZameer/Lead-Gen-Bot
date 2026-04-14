"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { analytics, getToken, clearToken, type DashboardData } from './lib/api';
import AppShell from './components/AppShell';

type QueueName = 'scraping' | 'enrichment' | 'scoring';



export default function Dashboard() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [scrapeQuery, setScrapeQuery] = useState('');
  const [scrapeLocation, setScrapeLocation] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState('');

  const fetchData = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    try {
      const dash = await analytics.dashboard();
      setData(dash);
    } catch {
      // silently refresh on error
    }
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
    fetchData();
    const refreshId = setInterval(fetchData, 15000);
    return () => clearInterval(refreshId);
  }, [fetchData]);

  if (!isMounted) return null;

  const kpis = data?.kpis;
  const STATS = [
    { label: 'Leads Found', value: kpis?.leadsToday ?? '—', color: 'blue', delta: 'NEW TODAY' },
    { label: '🔥 HIGH Opp.', value: kpis?.hotQueue ?? '—', color: 'orange', delta: 'SCORE >= 65' },
    { label: '⚡ MEDIUM Opp.', value: kpis?.warmQueue ?? '—', color: 'yellow', delta: 'SCORE 30–64' },
    { label: '❄️ LOW Opp.', value: kpis?.coldQueue ?? '—', color: 'cold', delta: 'SCORE < 30' },
    { label: 'Enriched', value: kpis?.enrichedToday ?? '—', color: 'green', delta: 'DEEP PARSED' },
    { label: 'AI Cost', value: kpis ? `$${kpis.aiCostToday.toFixed(3)}` : '—', color: '', delta: 'TODAY' },
  ];

  return (
    <AppShell>
      <div className="page-header">
        <div>
          <h1 className="page-title">Command Center</h1>
          <div className="page-subtitle">
            {kpis ? `${kpis.totalLeads.toLocaleString()} total leads in system` : 'Loading...'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/leads" className="btn btn-warm">View Leads</a>
          <a href="/settings" className="btn btn-ghost">Settings</a>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid">
        {STATS.map(s => (
          <div key={s.label} className="stat-block">
            <div className="stat-label">{s.label}</div>
            <div className={`stat-value${s.color ? ` ${s.color}` : ''}`}>{String(s.value)}</div>
            <div className="stat-delta">{s.delta}</div>
          </div>
        ))}
      </div>

      {/* Score distribution */}
      {data?.scoreDistribution && data.scoreDistribution.length > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <span className="panel-title">Score Distribution</span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 80, padding: '8px 0' }}>
            {data.scoreDistribution.map((bucket, i) => {
              const maxCount = Math.max(...data.scoreDistribution.map(b => b.count), 1);
              const h = Math.round((bucket.count / maxCount) * 64);
              const label = String(bucket._id);
              const isHigh = parseInt(label, 10) >= 65 || label.includes('high');
              const isMedium = parseInt(label, 10) >= 30 || label.includes('medium');
              const color = isHigh ? 'var(--primary)' : isMedium ? 'var(--warm)' : 'var(--cold)';
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 9, color: 'var(--fg-muted)' }}>{bucket.count}</div>
                  <div style={{ width: '100%', height: h, background: color, minHeight: 2 }} />
                  <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 8, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>{label}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent HOT/WARM leads preview */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Opportunity Pipeline</span>
          <a href="/leads?priority=high" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10 }}>VIEW ALL</a>
        </div>
        {!kpis || (kpis.hotQueue === 0 && kpis.warmQueue === 0) ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 32, color: 'var(--border-bright)', marginBottom: 12 }}>[ NO LEADS ]</div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Launch a search to find service opportunities.
            </div>
          </div>
        ) : (
          <div style={{ padding: '12px 0', color: 'var(--fg-dim)', fontSize: 12 }}>
            <span className="text-primary" style={{ fontFamily: "'Share Tech Mono'" }}>{kpis.hotQueue}</span> HIGH opportunity leads and{' '}
            <span className="text-warm" style={{ fontFamily: "'Share Tech Mono'" }}>{kpis.warmQueue}</span> MEDIUM opportunity leads found.{' '}
            <a href="/leads" style={{ color: 'var(--cold)', textDecoration: 'underline' }}>View leads &rarr;</a>
          </div>
        )}
      </div>

      {/* System log */}
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header">
          <span className="panel-title">System Log</span>
          <span className="text-muted" style={{ fontSize: 10, textTransform: 'uppercase' }}>Live</span>
        </div>
        <div className="console-block" style={{ maxHeight: 140 }}>
          <span className="info">[INFO]</span>{'  '}SYSTEM READY{'  '}HydraFox Lead Engine v3.0 online{'\n'}
          {kpis && <><span className="info">[INFO]</span>{'  '}Opportunity Pipeline: {kpis.hotQueue} HIGH | {kpis.warmQueue} MEDIUM | {kpis.coldQueue} LOW{'\n'}</>}
          {kpis && <><span className="info">[INFO]</span>{'  '}AI cost today: ${kpis.aiCostToday.toFixed(4)} / $5.00 budget{'\n'}</>}
          <span className="info">[INFO]</span>{'  '}All workers background active.{'\n'}
          {!data && <><span className="warn">[WAIT]</span>{'  '}Connecting to API...\n</>}
        </div>
      </div>
    </AppShell>
  );
}
