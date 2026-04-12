"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { leads, getToken, clearToken, type Lead, type LeadFilters } from '../lib/api';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Leads', href: '/leads' },
  { label: 'Campaigns', href: '/campaigns' },
  { label: 'Outreach', href: '/outreach' },
  { label: 'Analytics', href: '/analytics' },
  { label: 'Optimizer', href: '/optimizer' },
  { label: 'Settings', href: '/settings' },
];

const PRIORITY_COLORS: Record<string, string> = {
  hot: 'var(--primary)',
  warm: 'var(--warm)',
  cold: 'var(--cold)',
};

const STATUS_OPTIONS = ['new', 'enriched', 'scored', 'contacted', 'replied', 'won', 'lost', 'archived'];
const PRIORITY_OPTIONS = ['hot', 'warm', 'cold'];
const OUTCOME_OPTIONS = ['won', 'lost', 'no_reply', 'bounced', 'unsubscribed'];
const CHANNEL_OPTIONS = ['email', 'linkedin', 'phone', 'other'];

interface OutcomeModal {
  leadId: string;
  businessName: string;
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      fontSize: 9,
      fontFamily: "'Share Tech Mono', monospace",
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      border: `1px solid ${PRIORITY_COLORS[priority] ?? 'var(--border)'}`,
      color: PRIORITY_COLORS[priority] ?? 'var(--fg-dim)',
    }}>
      {priority}
    </span>
  );
}

function ScoreBar({ score, priority }: { score: number; priority: string }) {
  const color = priority === 'hot' ? 'var(--primary)' : priority === 'warm' ? 'var(--warm)' : 'var(--cold)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 60, height: 4, background: 'var(--border)', position: 'relative' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${score}%`, background: color }} />
      </div>
      <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color }}>{score}</span>
    </div>
  );
}

export default function LeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isMounted, setIsMounted] = useState(false);
  const [time, setTime] = useState('');
  const [currentPath, setCurrentPath] = useState('/leads');

  const [leadsData, setLeadsData] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);

  // Filters
  const [priority, setPriority] = useState(searchParams?.get('priority') ?? '');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);

  // Outcome modal
  const [outcomeModal, setOutcomeModal] = useState<OutcomeModal | null>(null);
  const [outcomeVal, setOutcomeVal] = useState('won');
  const [channelVal, setChannelVal] = useState('email');
  const [dealValue, setDealValue] = useState('');
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);

  // Detail panel
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [detailEnrichment, setDetailEnrichment] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    setLoading(true);
    try {
      const filters: LeadFilters = { page, limit: 50, sortBy, sortDir };
      if (priority) filters.priority = priority;
      if (status) filters.status = status;
      if (search.trim()) filters.search = search.trim();
      const result = await leads.list(filters);
      setLeadsData(result.data);
      setPagination(result.pagination);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [router, page, priority, status, search, sortBy, sortDir]);

  useEffect(() => {
    setIsMounted(true);
    setCurrentPath(window.location.pathname);
    const tick = () => setTime(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isMounted) fetchLeads();
  }, [isMounted, fetchLeads]);

  function logout() { clearToken(); router.push('/login'); }

  function toggleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
    setPage(1);
  }

  async function openDetail(lead: Lead) {
    setDetailLead(lead);
    setDetailEnrichment(null);
    setDetailLoading(true);
    try {
      const res = await leads.get(lead._id);
      setDetailLead(res.lead);
      setDetailEnrichment(res.enrichment as Record<string, unknown>);
    } catch {
      // silent
    } finally {
      setDetailLoading(false);
    }
  }

  async function submitOutcome() {
    if (!outcomeModal) return;
    setOutcomeSubmitting(true);
    try {
      await leads.logOutcome(outcomeModal.leadId, {
        actualOutcome: outcomeVal,
        channelUsed: channelVal,
        dealValue: dealValue ? Number(dealValue) : undefined,
      });
      setOutcomeModal(null);
      fetchLeads();
    } catch {
      // silent
    } finally {
      setOutcomeSubmitting(false);
    }
  }

  async function updateStatus(leadId: string, newStatus: string) {
    setUpdatingStatus(leadId);
    try {
      await leads.updateStatus(leadId, newStatus);
      setLeadsData(prev => prev.map(l => l._id === leadId ? { ...l, status: newStatus } : l));
    } catch {
      // silent
    } finally {
      setUpdatingStatus(null);
    }
  }

  if (!isMounted) return null;

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <span className="topbar-brand">HYDRA<span>FOX</span> <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>v3.0</span></span>
        <span style={{ color: 'var(--border-bright)', fontSize: 11 }}>|</span>
        <span style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lead Intelligence Engine</span>
        <div className="topbar-status">
          <div className="status-dot" />
          <span>SYS ONLINE</span>
          <span style={{ color: 'var(--fg-muted)', marginLeft: 12, fontFamily: "'Share Tech Mono', monospace" }}>{time}</span>
          <button className="btn btn-ghost" style={{ marginLeft: 16, padding: '2px 8px', fontSize: 10 }} onClick={logout}>LOGOUT</button>
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

        {/* Filter panel */}
        <div className="sidebar-section">
          <div className="sidebar-label">Filters</div>

          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: 4 }}>Priority</div>
          <select className="input" style={{ marginBottom: 8, fontSize: 10 }} value={priority} onChange={e => { setPriority(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
          </select>

          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: 4 }}>Status</div>
          <select className="input" style={{ marginBottom: 8, fontSize: 10 }} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>

          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--fg-muted)', marginBottom: 4 }}>Search</div>
          <input
            className="input"
            style={{ marginBottom: 8 }}
            placeholder="Business / domain..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />

          <button className="btn btn-ghost" style={{ width: '100%', fontSize: 10 }} onClick={() => { setPriority(''); setStatus(''); setSearch(''); setPage(1); }}>
            CLEAR FILTERS
          </button>
        </div>
      </nav>

      {/* Main */}
      <main className="main-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">Lead Pipeline</h1>
            <div className="page-subtitle">
              {loading ? 'Loading...' : `${pagination.total.toLocaleString()} leads${priority ? ` · ${priority.toUpperCase()}` : ''}${status ? ` · ${status.toUpperCase()}` : ''}`}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
              PAGE {pagination.page}/{pagination.pages}
            </span>
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10 }} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>&#8592; PREV</button>
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10 }} disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>NEXT &#8594;</button>
          </div>
        </div>

        {/* Table */}
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          {loading && leadsData.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center', fontFamily: "'Share Tech Mono', monospace", fontSize: 13, color: 'var(--fg-muted)' }}>
              [ LOADING LEADS... ]
            </div>
          ) : leadsData.length === 0 ? (
            <div style={{ padding: '60px 0', textAlign: 'center' }}>
              <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 28, color: 'var(--border-bright)', marginBottom: 10 }}>[ NO LEADS ]</div>
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Adjust filters or launch a scraper sweep from the dashboard.
              </div>
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>Business</th>
                  <th style={{ width: 140 }}>Domain</th>
                  <th style={{ width: 80, cursor: 'pointer' }} onClick={() => toggleSort('score')}>
                    Score {sortBy === 'score' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th style={{ width: 80 }}>Priority</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 100 }}>Industry</th>
                  <th style={{ width: 130, cursor: 'pointer' }} onClick={() => toggleSort('createdAt')}>
                    Created {sortBy === 'createdAt' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                  <th style={{ width: 160 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {leadsData.map(lead => (
                  <tr key={lead._id} onClick={() => openDetail(lead)} style={{ cursor: 'crosshair' }}>
                    <td style={{ fontWeight: 600, color: 'var(--fg)' }}>{lead.businessName}</td>
                    <td style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--fg-dim)' }}>{lead.domain}</td>
                    <td onClick={e => e.stopPropagation()}>
                      <ScoreBar score={lead.score} priority={lead.priority} />
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <PriorityBadge priority={lead.priority} />
                    </td>
                    <td onClick={e => e.stopPropagation()}>
                      <select
                        className="input"
                        style={{ padding: '2px 4px', fontSize: 9, background: 'transparent', width: '100%' }}
                        value={lead.status}
                        disabled={updatingStatus === lead._id}
                        onChange={e => updateStatus(lead._id, e.target.value)}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>{lead.industry ?? '—'}</td>
                    <td style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: 'var(--fg-muted)' }}>
                      {new Date(lead.createdAt).toISOString().slice(0, 10)}
                    </td>
                    <td onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '2px 8px', fontSize: 9 }}
                        onClick={() => setOutcomeModal({ leadId: lead._id, businessName: lead.businessName })}
                      >
                        OUTCOME
                      </button>
                      <a
                        href={lead.website ?? `https://${lead.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost"
                        style={{ padding: '2px 8px', fontSize: 9 }}
                        onClick={e => e.stopPropagation()}
                      >
                        SITE
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination footer */}
        {pagination.pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 12 }}>
            {Array.from({ length: Math.min(pagination.pages, 10) }, (_, i) => i + 1).map(p => (
              <button
                key={p}
                className={`btn ${p === page ? 'btn-primary' : 'btn-ghost'}`}
                style={{ padding: '2px 8px', fontSize: 10, minWidth: 32 }}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            {pagination.pages > 10 && <span style={{ color: 'var(--fg-muted)', fontSize: 10, padding: '4px 8px' }}>…{pagination.pages}</span>}
          </div>
        )}
      </main>

      {/* Detail panel overlay */}
      {detailLead && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(8,8,8,0.85)',
          display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', zIndex: 100,
        }} onClick={() => setDetailLead(null)}>
          <div style={{
            width: 480, background: 'var(--bg-2)', borderLeft: '1px solid var(--border)',
            overflowY: 'auto', padding: 24,
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 18, color: 'var(--fg)' }}>
                  {detailLead.businessName}
                </div>
                <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--fg-muted)', marginTop: 4 }}>
                  {detailLead.domain}
                </div>
              </div>
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10 }} onClick={() => setDetailLead(null)}>✕ CLOSE</button>
            </div>

            {/* Score + priority */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <div className="stat-block" style={{ flex: 1 }}>
                <div className="stat-label">Score</div>
                <div className={`stat-value ${detailLead.priority === 'hot' ? 'orange' : detailLead.priority === 'warm' ? 'yellow' : 'blue'}`}>
                  {detailLead.score}
                </div>
              </div>
              <div className="stat-block" style={{ flex: 1 }}>
                <div className="stat-label">Priority</div>
                <div className={`stat-value ${detailLead.priority === 'hot' ? 'orange' : detailLead.priority === 'warm' ? 'yellow' : 'blue'}`}>
                  {detailLead.priority.toUpperCase()}
                </div>
              </div>
              <div className="stat-block" style={{ flex: 1 }}>
                <div className="stat-label">Status</div>
                <div className="stat-value">{detailLead.status.toUpperCase()}</div>
              </div>
            </div>

            {/* Score breakdown */}
            {detailLead.scoreBreakdown && Object.keys(detailLead.scoreBreakdown).length > 0 && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-header"><span className="panel-title">Score Breakdown</span></div>
                <div style={{ padding: '4px 0' }}>
                  {Object.entries(detailLead.scoreBreakdown).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 4px', fontSize: 11 }}>
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', fontSize: 10 }}>{k}</span>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", color: v > 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {v > 0 ? `+${v}` : v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Enrichment data */}
            {detailLoading ? (
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', padding: '20px 0' }}>
                [ LOADING ENRICHMENT... ]
              </div>
            ) : detailEnrichment ? (
              <>
                <div className="panel" style={{ marginBottom: 16 }}>
                  <div className="panel-header"><span className="panel-title">Tech Stack</span></div>
                  <div style={{ padding: '8px 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {((detailEnrichment.techStack as string[]) ?? []).length > 0
                      ? (detailEnrichment.techStack as string[]).map((t: string) => (
                          <span key={t} style={{ fontSize: 9, padding: '2px 6px', border: '1px solid var(--border)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--cold)' }}>{t}</span>
                        ))
                      : <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>No tech detected</span>
                    }
                  </div>
                </div>

                {(detailEnrichment as Record<string, unknown>).detectedPains && (
                  <div className="panel" style={{ marginBottom: 16 }}>
                    <div className="panel-header"><span className="panel-title">AI Analysis</span></div>
                    <div style={{ padding: '8px 4px' }}>
                      <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Detected Pains</div>
                      <div style={{ fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.6 }}>
                        {String((detailEnrichment as Record<string, unknown>).detectedPains)}
                      </div>
                      {(detailEnrichment as Record<string, unknown>).pitchAngle && (
                        <>
                          <div style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', marginTop: 10, marginBottom: 4 }}>Pitch Angle</div>
                          <div style={{ fontSize: 11, color: 'var(--primary)', lineHeight: 1.6 }}>
                            {String((detailEnrichment as Record<string, unknown>).pitchAngle)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="panel" style={{ marginBottom: 16 }}>
                  <div className="panel-header"><span className="panel-title">Signals</span></div>
                  <div style={{ padding: '4px 0' }}>
                    {[
                      ['CMS', (detailEnrichment as Record<string, unknown>).cms],
                      ['Has Booking', String((detailEnrichment as Record<string, unknown>).hasBookingSystem)],
                      ['Has Chatbot', String((detailEnrichment as Record<string, unknown>).hasChatbot)],
                      ['Has Contact Form', String((detailEnrichment as Record<string, unknown>).hasContactForm)],
                      ['Has E-Commerce', String((detailEnrichment as Record<string, unknown>).hasEcommerce)],
                      ['Automation Level', (detailEnrichment as Record<string, unknown>).automationLevel],
                      ['SEO Score', (detailEnrichment as Record<string, unknown>).syntheticSeoScore],
                      ['Perf Score', (detailEnrichment as Record<string, unknown>).syntheticPerformanceScore],
                    ].filter(([, v]) => v != null && v !== 'undefined' && v !== 'null').map(([label, value]) => (
                      <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 4px', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
                        <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', fontSize: 10 }}>{String(label)}</span>
                        <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--fg-dim)' }}>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => {
                  setOutcomeModal({ leadId: detailLead._id, businessName: detailLead.businessName });
                  setDetailLead(null);
                }}
              >
                LOG OUTCOME
              </button>
              {detailLead.website && (
                <a href={detailLead.website} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ flex: 1, textAlign: 'center' }}>
                  VISIT SITE
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Outcome modal */}
      {outcomeModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(8,8,8,0.9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setOutcomeModal(null)}>
          <div style={{ width: 360, background: 'var(--bg-2)', border: '1px solid var(--border)', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 14, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Log Outcome
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 20 }}>{outcomeModal.businessName}</div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>Outcome</div>
              <select className="input" value={outcomeVal} onChange={e => setOutcomeVal(e.target.value)}>
                {OUTCOME_OPTIONS.map(o => <option key={o} value={o}>{o.toUpperCase().replace('_', ' ')}</option>)}
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>Channel Used</div>
              <select className="input" value={channelVal} onChange={e => setChannelVal(e.target.value)}>
                {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            </div>

            {outcomeVal === 'won' && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>Deal Value ($)</div>
                <input
                  type="number"
                  className="input"
                  placeholder="e.g. 1500"
                  value={dealValue}
                  onChange={e => setDealValue(e.target.value)}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitOutcome} disabled={outcomeSubmitting}>
                {outcomeSubmitting ? 'SAVING...' : '> SUBMIT'}
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setOutcomeModal(null)}>CANCEL</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
