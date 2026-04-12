"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { analytics, jobs, getToken, clearToken, type DashboardData, type QueueStats } from './lib/api';

type QueueName = 'scraping' | 'enrichment' | 'scoring';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Leads', href: '/leads' },
  { label: 'Campaigns', href: '/campaigns' },
  { label: 'Outreach', href: '/outreach' },
  { label: 'Analytics', href: '/analytics' },
  { label: 'Optimizer', href: '/optimizer' },
  { label: 'Settings', href: '/settings' },
];

function ScoreBar({ score, priority }: { score: number; priority: string }) {
  const fillClass = priority === 'warm' ? 'warm' : priority === 'cold' ? 'cold' : '';
  const numClass = priority === 'hot' ? 'text-primary' : priority === 'warm' ? 'text-warm' : 'text-cold';
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        <div className={`score-bar-fill ${fillClass}`} style={{ width: `${score}%` }} />
      </div>
      <span className={`score-num ${numClass}`}>{score}</span>
    </div>
  );
}

function QueueBlock({ name, counts, paused }: { name: string; counts: Record<string, number>; paused: boolean }) {
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      if (paused) await jobs.resume(name);
      else await jobs.pause(name);
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: paused ? 'var(--danger)' : 'var(--fg-dim)' }}>
          {name} {paused && '(paused)'}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 11, color: 'var(--fg-muted)', marginTop: 2 }}>
          W:{counts.waiting ?? 0} A:{counts.active ?? 0} D:{counts.failed ?? 0}
        </div>
      </div>
      <button className={`btn ${paused ? 'btn-warm' : 'btn-ghost'}`} style={{ padding: '2px 8px', fontSize: 9 }} onClick={toggle} disabled={loading}>
        {paused ? 'RESUME' : 'PAUSE'}
      </button>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [time, setTime] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [queueData, setQueueData] = useState<QueueStats | null>(null);
  const [scrapeQuery, setScrapeQuery] = useState('');
  const [scrapeLocation, setScrapeLocation] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState('');
  const [currentPath, setCurrentPath] = useState('/');

  const fetchData = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    try {
      const [dash, q] = await Promise.all([analytics.dashboard(), jobs.stats()]);
      setData(dash);
      setQueueData(q);
    } catch {
      // silently refresh on error
    }
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
    setCurrentPath(window.location.pathname);
    const tick = () => setTime(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    tick();
    const clockId = setInterval(tick, 1000);
    fetchData();
    const refreshId = setInterval(fetchData, 15000);
    return () => { clearInterval(clockId); clearInterval(refreshId); };
  }, [fetchData]);

  async function launchScraper() {
    if (!scrapeQuery.trim()) return;
    setLaunching(true);
    setLaunchMsg('');
    try {
      const result = await jobs.enqueueScrape(scrapeQuery, 'gmaps', scrapeLocation || undefined);
      setLaunchMsg(`Job queued: ${result.jobId}`);
      setScrapeQuery('');
      setScrapeLocation('');
    } catch (err) {
      setLaunchMsg(`Error: ${(err as Error).message}`);
    } finally {
      setLaunching(false);
    }
  }

  function logout() {
    clearToken();
    router.push('/login');
  }

  if (!isMounted) return null;

  const kpis = data?.kpis;
  const STATS = [
    { label: 'Leads Today', value: kpis?.leadsToday ?? '—', color: 'orange', delta: 'NEW THIS DAY' },
    { label: 'HOT Queue', value: kpis?.hotQueue ?? '—', color: 'orange', delta: 'SCORE >= 80' },
    { label: 'WARM Queue', value: kpis?.warmQueue ?? '—', color: 'yellow', delta: 'SCORE 55–79' },
    { label: 'Enriched Today', value: kpis?.enrichedToday ?? '—', color: 'blue', delta: 'PROCESSED' },
    { label: 'Contacted (7d)', value: kpis?.contactedLast7d ?? '—', color: '', delta: 'OUTREACH SENT' },
    { label: 'AI Cost Today', value: kpis ? `$${kpis.aiCostToday.toFixed(3)}` : '—', color: 'green', delta: 'DAILY BUDGET' },
  ];

  const queueNames: QueueName[] = ['scraping', 'enrichment', 'scoring'];

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <span className="topbar-brand">HYDRA<span>FOX</span> <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>v3.0</span></span>
        <span style={{ color: 'var(--border-bright)', fontSize: 11 }}>|</span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Lead Intelligence Engine
        </span>
        <div className="topbar-status">
          <div className="status-dot" />
          <span>SYS ONLINE</span>
          <span style={{ color: 'var(--fg-muted)', marginLeft: 12, fontFamily: "'Share Tech Mono', monospace" }}>{time}</span>
          <button className="btn btn-ghost" style={{ marginLeft: 16, padding: '2px 8px', fontSize: 10 }} onClick={logout}>
            LOGOUT
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <nav className="sidebar">
        <div className="sidebar-section">
          <div className="sidebar-label">Navigation</div>
          {NAV_ITEMS.map(item => (
            <a key={item.href} href={item.href} className={`nav-item${currentPath === item.href ? ' active' : ''}`}>
              <span style={{ color: 'var(--fg-muted)', marginRight: 4 }}>&rsaquo;</span>
              {item.label}
            </a>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Queues</div>
          {queueNames.map(name => (
            <QueueBlock
              key={name}
              name={name}
              counts={queueData?.stats[name] ?? {}}
              paused={queueData?.paused[name] ?? false}
            />
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-label">Launch Scraper</div>
          <input
            className="input"
            style={{ marginBottom: 6 }}
            placeholder="Query (e.g. dentist)"
            value={scrapeQuery}
            onChange={e => setScrapeQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && launchScraper()}
          />
          <input
            className="input"
            style={{ marginBottom: 8 }}
            placeholder="Location (optional)"
            value={scrapeLocation}
            onChange={e => setScrapeLocation(e.target.value)}
          />
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={launchScraper} disabled={launching || !scrapeQuery.trim()}>
            {launching ? 'QUEUING...' : '> LAUNCH'}
          </button>
          {launchMsg && (
            <div style={{ fontSize: 10, marginTop: 6, color: launchMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)', textTransform: 'uppercase', wordBreak: 'break-all' }}>
              {launchMsg}
            </div>
          )}
        </div>
      </nav>

      {/* Main */}
      <main className="main-content">
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
                const isHot = parseInt(label, 10) >= 80 || label.includes('80');
                const isWarm = parseInt(label, 10) >= 55 || label.includes('55') || label.includes('70');
                const color = isHot ? 'var(--primary)' : isWarm ? 'var(--warm)' : 'var(--cold)';
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
            <span className="panel-title">Priority Queue</span>
            <a href="/leads?priority=hot" className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10 }}>VIEW ALL</a>
          </div>
          {!kpis || (kpis.hotQueue === 0 && kpis.warmQueue === 0) ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 32, color: 'var(--border-bright)', marginBottom: 12 }}>[ NO LEADS ]</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Use the sidebar to launch a scraper sweep.
              </div>
            </div>
          ) : (
            <div style={{ padding: '12px 0', color: 'var(--fg-dim)', fontSize: 12 }}>
              <span className="text-primary" style={{ fontFamily: "'Share Tech Mono'" }}>{kpis.hotQueue}</span> HOT leads and{' '}
              <span className="text-warm" style={{ fontFamily: "'Share Tech Mono'" }}>{kpis.warmQueue}</span> WARM leads awaiting outreach.{' '}
              <a href="/leads" style={{ color: 'var(--cold)', textDecoration: 'underline' }}>Open lead pipeline &rarr;</a>
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
            <span className="info">[INFO]</span>{'  '}{time}{'  '}HydraFox Lead Engine v3.0 online{'\n'}
            {kpis && <><span className="info">[INFO]</span>{'  '}Pipeline: {kpis.hotQueue} HOT | {kpis.warmQueue} WARM | {kpis.coldQueue} COLD{'\n'}</>}
            {kpis && <><span className="info">[INFO]</span>{'  '}AI cost today: ${kpis.aiCostToday.toFixed(4)} / $5.00 budget{'\n'}</>}
            {queueData && queueNames.map(n => (
              <span key={n}>
                <span className={queueData.paused[n] ? 'warn' : 'info'}>[{queueData.paused[n] ? 'WARN' : 'INFO'}]</span>
                {'  '}Queue {n}: {queueData.paused[n] ? 'PAUSED' : 'active'} | waiting={queueData.stats[n]?.waiting ?? 0}{'\n'}
              </span>
            ))}
            {!data && <><span className="warn">[WAIT]</span>{'  '}Connecting to API...\n</>}
          </div>
        </div>
      </main>
    </div>
  );
}
