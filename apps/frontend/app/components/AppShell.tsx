"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { getToken, clearToken, jobs, type QueueStats } from '../lib/api';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Leads', href: '/leads' },
  { label: 'Campaigns', href: '/campaigns' },
  { label: 'Outreach', href: '/outreach' },
  { label: 'Analytics', href: '/analytics' },
  { label: 'Optimizer', href: '/optimizer' },
  { label: 'Settings', href: '/settings' },
];

// ── Source definitions ────────────────────────────────────────────────────────

interface SourceDef {
  id: string;
  label: string;
  icon: string;
  available: boolean;
  color: string;
}

const SOURCES: SourceDef[] = [
  { id: 'gmaps',       label: 'Google Maps',   icon: 'G',  available: true,  color: '#4285F4' },
  { id: 'yellowpages', label: 'Yellow Pages',  icon: 'YP', available: true,  color: '#FFD700' },
  { id: 'yelp',        label: 'Yelp',          icon: 'Y',  available: true,  color: '#FF1A1A' },
  { id: 'linkedin',    label: 'LinkedIn',      icon: 'in', available: true,  color: '#0A66C2' },
];

// ── Popular location presets ──────────────────────────────────────────────────

const POPULAR_LOCATIONS = [
  '', // blank = auto-expand
  'New York, NY',
  'Los Angeles, CA',
  'Chicago, IL',
  'Houston, TX',
  'Phoenix, AZ',
  'Philadelphia, PA',
  'San Antonio, TX',
  'San Diego, CA',
  'Dallas, TX',
  'Austin, TX',
  'Miami, FL',
  'Seattle, WA',
  'Denver, CO',
  'Boston, MA',
  'Atlanta, GA',
  'London, UK',
  'Toronto, Canada',
  'Dubai, UAE',
  'Sydney, Australia',
];

// ── Queue block component ─────────────────────────────────────────────────────

function QueueBlock({
  name,
  counts,
  paused,
  onToggle,
}: {
  name: string;
  counts: Record<string, number>;
  paused: boolean;
  onToggle: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      if (paused) await jobs.resume(name);
      else await jobs.pause(name);
      onToggle();
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  const hasFailed = (counts.failed ?? 0) > 0;

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 4px', borderBottom: '1px solid var(--border)',
    }}>
      <div>
        <div style={{
          fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em',
          color: paused ? 'var(--danger)' : 'var(--fg-dim)',
        }}>
          {name} {paused && <span style={{ color: 'var(--danger)' }}>(PAUSED)</span>}
        </div>
        <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 10, color: 'var(--fg-muted)', marginTop: 2 }}>
          <span title="Waiting">W:{counts.waiting ?? 0}</span>{' '}
          <span title="Active" style={{ color: (counts.active ?? 0) > 0 ? 'var(--success)' : undefined }}>
            A:{counts.active ?? 0}
          </span>{' '}
          <span title="Failed" style={{ color: hasFailed ? 'var(--danger)' : undefined }}>
            F:{counts.failed ?? 0}
          </span>
        </div>
      </div>
      <button
        className={`btn ${paused ? 'btn-warm' : 'btn-ghost'}`}
        style={{ padding: '2px 8px', fontSize: 9 }}
        onClick={toggle}
        disabled={loading}
      >
        {paused ? 'RESUME' : 'PAUSE'}
      </button>
    </div>
  );
}

// ── Toast notification ────────────────────────────────────────────────────────

function Toast({ query, onClose }: { query: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--primary)',
      borderRadius: 6, padding: '14px 18px', minWidth: 280, maxWidth: 360,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column', gap: 8,
      animation: 'slideUp 0.25s ease',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>✅</span>
          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--success)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Research Complete
          </span>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--fg-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
        >✕</button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-dim)' }}>
        Leads for <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{query}</span> have been scraped, enriched, and scored.
      </div>
      <Link
        href="/leads?sortBy=createdAt&sortDir=desc"
        onClick={onClose}
        style={{ fontSize: 10, color: 'var(--primary)', textDecoration: 'none', fontFamily: "'Share Tech Mono', monospace", letterSpacing: '0.08em' }}
      >
        VIEW NEW LEADS →
      </Link>
    </div>
  );
}

// ── AppShell ──────────────────────────────────────────────────────────────────

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const currentPath = usePathname();

  const [isMounted, setIsMounted] = useState(false);
  const [time, setTime] = useState('');
  const [queueData, setQueueData] = useState<QueueStats | null>(null);

  // Scraper state
  const [scrapeQuery, setScrapeQuery] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>(['gmaps']);
  const [locationPreset, setLocationPreset] = useState('');
  const [locationCustom, setLocationCustom] = useState('');
  const [useCustomLocation, setUseCustomLocation] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const [scrapeLog, setScrapeLogRaw] = useState<string[]>([]);
  const [activeJobId, setActiveJobIdRaw] = useState<string | null>(null);

  // Completion toast
  const [toastQuery, setToastQuery] = useState<string | null>(null);

  function setScrapeLog(lines: string[] | ((prev: string[]) => string[])) {
    setScrapeLogRaw(prev => {
      const next = typeof lines === 'function' ? lines(prev) : lines;
      try { localStorage.setItem('hf_scrape_log', JSON.stringify(next.filter(Boolean))); } catch { /* ignore */ }
      return next.filter(Boolean);
    });
  }

  function setActiveJobId(id: string | null) {
    setActiveJobIdRaw(id);
    try {
      if (id) localStorage.setItem('hf_scrape_job', id);
      else localStorage.removeItem('hf_scrape_job');
    } catch { /* ignore */ }
  }

  function toggleSource(id: string) {
    setSelectedSources(prev => {
      if (prev.includes(id)) {
        // Always keep at least one source selected
        if (prev.length === 1) return prev;
        return prev.filter(s => s !== id);
      }
      return [...prev, id];
    });
  }

  const resolvedLocation = useCustomLocation
    ? locationCustom.trim()
    : locationPreset;

  const fetchStats = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    try {
      const q = await jobs.stats();
      setQueueData(q);
    } catch { /* Silently fail */ }
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
    try {
      const savedLog = localStorage.getItem('hf_scrape_log');
      const savedJob = localStorage.getItem('hf_scrape_job');
      if (savedLog) {
        const parsed = JSON.parse(savedLog) as unknown[];
        setScrapeLogRaw((parsed as string[]).filter(l => typeof l === 'string'));
      }
      if (savedJob) setActiveJobIdRaw(savedJob);
    } catch { /* ignore */ }

    const tick = () => setTime(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    tick();
    const clockId = setInterval(tick, 1000);
    fetchStats();
    const refreshId = setInterval(fetchStats, 15000);
    return () => { clearInterval(clockId); clearInterval(refreshId); };
  }, [fetchStats]);

  async function launchScraper() {
    const q = scrapeQuery.trim();
    if (!q) return;
    if (selectedSources.length === 0) {
      setLaunchError('Select at least one source.');
      return;
    }

    setLaunching(true);
    setLaunchError('');
    setScrapeLog([]);

    // Request browser notification permission on first launch (requires user gesture)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    try {
      setScrapeLog([`[INIT] Connecting to scraper engine...`]);
      const loc = resolvedLocation || undefined;
      const result = await jobs.enqueueScrape(q, selectedSources, loc, !loc);
      setActiveJobId(result.jobId);
      setScrapeQuery('');

      const srcLabels = selectedSources
        .map(s => SOURCES.find(d => d.id === s)?.label ?? s)
        .join(', ');

      setScrapeLog([
        `[OK]   Job #${result.jobId} queued`,
        `[SCAN] Query: "${q}"${loc ? ` in ${loc}` : ' (auto-location expand)'}`,
        `[SRC]  Sources: ${srcLabels}`,
        `[WAIT] Scraping in progress...`,
      ]);

      const phases = [
        `[DATA]   Extracting business listings...`,
        `[ENRICH] Fetching website & contact data...`,
        `[SCORE]  Classifying opportunity levels...`,
        `[DONE]   Check Leads page for results →`,
      ];
      let i = 0;
      const interval = setInterval(() => {
        if (i < phases.length) {
          setScrapeLog(prev => [...prev, phases[i]]);
          i++;
        } else {
          clearInterval(interval);
          setActiveJobId(null);
          fetchStats();
          // In-app toast
          setToastQuery(q);
          // OS-level browser notification (fires even when tab is not focused)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('HydraFox — Research Complete', {
              body: `Leads for "${q}" are ready. Click to view.`,
              icon: '/favicon.ico',
            });
          }
        }
      }, 7000);
    } catch (err) {
      const msg = (err as Error).message || 'Unknown error';
      setLaunchError(msg);
      setScrapeLog([]);
    } finally {
      setLaunching(false);
    }
  }

  function logout() {
    clearToken();
    router.push('/login');
  }

  if (!isMounted) return null;

  const queueNames: ('scraping' | 'enrichment' | 'scoring')[] = ['scraping', 'enrichment', 'scoring'];

  return (
    <div className="app-shell">
      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <header className="topbar">
        <span className="topbar-brand">
          HYDRA<span>FOX</span>{' '}
          <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>v3.0</span>
        </span>
        <span style={{ color: 'var(--border-bright)', fontSize: 11 }}>|</span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Lead Intelligence Engine
        </span>
        <div className="topbar-status">
          <div className="status-dot" />
          <span>SYS ONLINE</span>
          <span style={{ color: 'var(--fg-muted)', marginLeft: 12, fontFamily: "'Share Tech Mono', monospace" }}>
            {time}
          </span>
          <button
            className="btn btn-ghost"
            style={{ marginLeft: 16, padding: '2px 8px', fontSize: 10 }}
            onClick={logout}
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <nav className="sidebar">

        {/* Navigation */}
        <div className="sidebar-section">
          <div className="sidebar-label">Navigation</div>
          {NAV_ITEMS.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${currentPath === item.href ? ' active' : ''}`}
            >
              <span style={{ color: 'var(--fg-muted)', marginRight: 4 }}>&rsaquo;</span>
              {item.label}
            </Link>
          ))}
        </div>

        {/* Queue monitors */}
        <div className="sidebar-section">
          <div className="sidebar-label">Queues</div>
          {queueNames.map(name => (
            <QueueBlock
              key={name}
              name={name}
              counts={queueData?.stats[name] ?? {}}
              paused={queueData?.paused[name] ?? false}
              onToggle={fetchStats}
            />
          ))}
        </div>

        {/* Scraper launcher */}
        <div className="sidebar-section">
          <div className="sidebar-label">Launch Scraper</div>

          {/* ── Source multi-select ─────────────────────────────────────── */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sources <span style={{ color: 'var(--fg-muted)', opacity: 0.6 }}>(select all that apply)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {SOURCES.map(src => {
                const checked = selectedSources.includes(src.id);
                return (
                  <label
                    key={src.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: src.available ? 'pointer' : 'not-allowed',
                      opacity: src.available ? 1 : 0.4,
                      padding: '4px 6px',
                      border: `1px solid ${checked ? src.color : 'var(--border)'}`,
                      borderRadius: 2,
                      background: checked ? `${src.color}14` : 'transparent',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!src.available}
                      onChange={() => src.available && toggleSource(src.id)}
                      style={{ accentColor: src.color, width: 12, height: 12, cursor: 'pointer' }}
                    />
                    <span
                      style={{
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: 9,
                        fontWeight: 700,
                        color: src.color,
                        minWidth: 18,
                        textAlign: 'center',
                        border: `1px solid ${src.color}`,
                        padding: '0 3px',
                        borderRadius: 2,
                      }}
                    >
                      {src.icon}
                    </span>
                    <span style={{ fontSize: 10, color: checked ? 'var(--fg)' : 'var(--fg-dim)', letterSpacing: '0.04em' }}>
                      {src.label}
                    </span>
                    {!src.available && (
                      <span style={{ fontSize: 8, color: 'var(--fg-muted)', marginLeft: 'auto' }}>SOON</span>
                    )}
                  </label>
                );
              })}
            </div>
            <div style={{ fontSize: 8, color: 'var(--fg-muted)', marginTop: 4 }}>
              {selectedSources.length} source{selectedSources.length !== 1 ? 's' : ''} selected
            </div>
          </div>

          {/* ── Query input ────────────────────────────────────────────── */}
          <input
            className="input"
            style={{ marginBottom: 6 }}
            placeholder="Industry / keyword (e.g. dentist)"
            value={scrapeQuery}
            onChange={e => setScrapeQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !activeJobId && launchScraper()}
            disabled={!!activeJobId}
          />

          {/* ── Location combobox ──────────────────────────────────────── */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4, textTransform: 'uppercase' }}>
              Location
            </div>
            {!useCustomLocation ? (
              <div style={{ display: 'flex', gap: 4 }}>
                <select
                  className="input"
                  style={{ flex: 1, fontSize: 10 }}
                  value={locationPreset}
                  onChange={e => setLocationPreset(e.target.value)}
                  disabled={!!activeJobId}
                >
                  <option value="">Auto-expand (multi-city)</option>
                  {POPULAR_LOCATIONS.filter(Boolean).map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
                <button
                  className="btn btn-ghost"
                  style={{ padding: '2px 6px', fontSize: 9, whiteSpace: 'nowrap' }}
                  onClick={() => setUseCustomLocation(true)}
                  title="Type a custom location"
                >
                  ✎
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="City, State or Country…"
                  value={locationCustom}
                  onChange={e => setLocationCustom(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !activeJobId && launchScraper()}
                  disabled={!!activeJobId}
                  autoFocus
                />
                <button
                  className="btn btn-ghost"
                  style={{ padding: '2px 6px', fontSize: 9 }}
                  onClick={() => { setUseCustomLocation(false); setLocationCustom(''); }}
                  title="Use preset locations"
                >
                  ↩
                </button>
              </div>
            )}
            <div style={{ fontSize: 8, color: 'var(--fg-muted)', marginTop: 3 }}>
              {resolvedLocation
                ? `Target: ${resolvedLocation}`
                : 'No location → auto-expands to multiple cities'}
            </div>
          </div>

          {/* ── Launch button ──────────────────────────────────────────── */}
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={launchScraper}
            disabled={launching || !!activeJobId || !scrapeQuery.trim() || selectedSources.length === 0}
          >
            {launching
              ? 'QUEUING…'
              : activeJobId
              ? `⟳ RUNNING #${activeJobId}…`
              : `▶ RUN SEARCH (${selectedSources.length} SRC)`}
          </button>

          {/* Error message */}
          {launchError && (
            <div style={{
              fontSize: 10, marginTop: 6, color: 'var(--danger)',
              padding: '4px 6px', border: '1px solid var(--danger)',
              wordBreak: 'break-all',
            }}>
              ERROR: {launchError}
            </div>
          )}

          {/* Scrape log */}
          {scrapeLog.length > 0 && (
            <div style={{
              marginTop: 8, padding: '8px 6px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              fontSize: 9, fontFamily: "'Share Tech Mono', monospace",
              lineHeight: 1.9, color: 'var(--fg-muted)',
              maxHeight: 160, overflowY: 'auto', position: 'relative',
            }}>
              {!activeJobId && (
                <div
                  onClick={() => { setScrapeLog([]); setActiveJobId(null); }}
                  style={{
                    position: 'absolute', top: 4, right: 6,
                    cursor: 'pointer', fontSize: 10, color: 'var(--fg-muted)', opacity: 0.6,
                  }}
                >
                  ✕
                </div>
              )}
              {scrapeLog.filter(Boolean).map((line, i) => (
                <div
                  key={i}
                  style={{
                    color: line.startsWith('[OK]') || line.startsWith('[DONE]')
                      ? 'var(--success)'
                      : line.startsWith('[SCORE]') || line.startsWith('[AI]')
                      ? 'var(--primary)'
                      : line.startsWith('[WAIT]') || line.startsWith('[ENRICH]')
                      ? 'var(--warm)'
                      : line.startsWith('[DATA]')
                      ? 'var(--fg)'
                      : line.startsWith('[SRC]')
                      ? 'var(--cold)'
                      : 'var(--fg-muted)',
                  }}
                >
                  {line}
                  {i === scrapeLog.length - 1 && activeJobId && (
                    <span style={{ animation: 'blink 1s step-end infinite' }}> ▋</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Link to leads after job completes */}
          {!activeJobId && scrapeLog.some(l => l.includes('[DONE]')) && (
            <Link
              href="/leads?sortBy=createdAt&sortDir=desc"
              className="btn btn-warm"
              style={{ width: '100%', marginTop: 6, textAlign: 'center', display: 'block', fontSize: 10 }}
            >
              VIEW RESULTS →
            </Link>
          )}
        </div>
      </nav>

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <main className="main-content">
        {children}
      </main>

      {/* ── Completion toast ───────────────────────────────────────────────── */}
      {toastQuery && (
        <Toast query={toastQuery} onClose={() => setToastQuery(null)} />
      )}
    </div>
  );
}
