"use client";

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { leads, getToken, subscribeLeads, type Lead, type LeadFilters } from '../lib/api';
import AppShell from '../components/AppShell';

const OPP_COLOR: Record<string, string> = {
  high:   'var(--primary)',
  medium: 'var(--warm)',
  low:    'var(--cold)',
};

const OPP_EMOJI: Record<string, string> = {
  high:   '🔥',
  medium: '⚡',
  low:    '❄️',
};

const STATUS_OPTIONS  = ['new', 'enriched', 'reviewed', 'contacted', 'won', 'lost', 'archived'];
const OPP_OPTIONS     = ['high', 'medium', 'low'];
const OUTCOME_OPTIONS = ['replied', 'interested', 'converted', 'ignored', 'bounced', 'objected'];
const CHANNEL_OPTIONS = ['email', 'linkedin', 'phone', 'whatsapp', 'other'];

interface OutcomeModal { leadId: string; businessName: string }

// ── Small reusable components ────────────────────────────────────────────────

function OpportunityBadge({ level }: { level: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 8px', fontSize: 9,
      fontFamily: "'Share Tech Mono', monospace", fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase',
      border: `1px solid ${OPP_COLOR[level] ?? 'var(--border)'}`,
      color: OPP_COLOR[level] ?? 'var(--fg-dim)',
      borderRadius: 3,
      background: `${OPP_COLOR[level] ?? 'transparent'}18`,
    }}>
      {OPP_EMOJI[level]} {level}
    </span>
  );
}

function ScoreBar({ score, level }: { score: number; level: string }) {
  const color = OPP_COLOR[level] ?? 'var(--border)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 56, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(score, 100)}%`, background: color, borderRadius: 3,
          transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color, minWidth: 22 }}>
        {score}
      </span>
    </div>
  );
}

function ContactCell({ email, phone }: { email?: string; phone?: string }) {
  if (email) return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--fg)', wordBreak: 'break-all' }}>
        {email.length > 24 ? email.slice(0, 24) + '…' : email}
      </div>
      {phone && <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginTop: 1 }}>{phone}</div>}
    </div>
  );
  if (phone) return <div style={{ fontSize: 10 }}>{phone}</div>;
  return <span style={{ fontSize: 9, color: 'var(--danger)', letterSpacing: '0.06em' }}>NO CONTACT</span>;
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: '8px 0' }}>
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, padding: '12px 16px',
          borderBottom: '1px solid var(--border)', opacity: 1 - i * 0.1,
        }}>
          <div style={{ flex: 2.5, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1.5, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 0.8, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 0.8, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 0.8, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
        </div>
      ))}
    </div>
  );
}

// ── Lead detail modal ────────────────────────────────────────────────────────

function LeadDetailModal({ lead, enrichment, loading, onClose }: {
  lead: Lead;
  enrichment: Record<string, unknown> | null;
  loading: boolean;
  onClose: () => void;
}) {
  const websiteUrl = lead.website ?? (lead.domain ? `https://${lead.domain}` : null);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: 540, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="panel-header" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1, gap: 8 }}>
          <span className="panel-title" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead.businessName}
          </span>
          {websiteUrl && (
            <a
              href={websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="btn btn-primary"
              style={{ padding: '3px 10px', fontSize: 10, textDecoration: 'none', whiteSpace: 'nowrap' }}
              onClick={e => e.stopPropagation()}
            >
              🌐 VISIT SITE
            </a>
          )}
          <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 10 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Score + Badge + Status */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <OpportunityBadge level={lead.opportunityLevel} />
            <ScoreBar score={lead.opportunityScore} level={lead.opportunityLevel} />
            <span style={{
              fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase',
              padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 2,
            }}>
              {lead.status}
            </span>
            <span style={{ fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>
              {lead.source?.toUpperCase()}
            </span>
          </div>

          {/* Business Info */}
          <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Business Info</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>DOMAIN</div>
                <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace" }}>{lead.domain}</div>
              </div>
              {lead.website && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>WEBSITE</div>
                  <a href={lead.website} target="_blank" rel="noreferrer"
                    style={{ fontSize: 11, color: 'var(--primary)', textDecoration: 'none', wordBreak: 'break-all' }}>
                    {lead.website.replace(/^https?:\/\//, '').slice(0, 36)}…
                  </a>
                </div>
              )}
              {lead.industry && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>INDUSTRY</div>
                  <div style={{ fontSize: 11 }}>{lead.industry}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>TIER / ADDED</div>
                <div style={{ fontSize: 11 }}>T{lead.industryTier} · {new Date(lead.createdAt).toLocaleDateString()}</div>
              </div>
            </div>
          </div>

          {/* Contact */}
          <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Contact Info</div>
            {!lead.email && !lead.phone ? (
              <div style={{ fontSize: 11, color: 'var(--danger)' }}>No contact info extracted yet</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {lead.email && (
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>EMAIL</div>
                    <a href={`mailto:${lead.email}`} style={{ fontSize: 11, color: 'var(--primary)', textDecoration: 'none' }}>
                      {lead.email}
                    </a>
                  </div>
                )}
                {lead.phone && (
                  <div>
                    <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>PHONE</div>
                    <a href={`tel:${lead.phone}`} style={{ fontSize: 11, color: 'var(--success)', textDecoration: 'none' }}>
                      {lead.phone}
                    </a>
                  </div>
                )}
              </div>
            )}
            {lead.socialLinks?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>SOCIAL LINKS</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {lead.socialLinks.map((link, i) => (
                    <a key={i} href={link.startsWith('http') ? link : `https://${link}`}
                      target="_blank" rel="noreferrer"
                      style={{ fontSize: 10, color: 'var(--primary)', wordBreak: 'break-all' }}>
                      {link}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Score Breakdown */}
          {lead.scoreBreakdown && Object.keys(lead.scoreBreakdown).length > 0 && (
            <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Score Breakdown</div>
              {Object.entries(lead.scoreBreakdown).map(([factor, pts]) => (
                <div key={factor} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 5, alignItems: 'center' }}>
                  <span style={{ color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {factor.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                  <span style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    color: typeof pts === 'number' && pts > 1 ? 'var(--primary)' : 'var(--warm)',
                    fontSize: 11,
                  }}>
                    {typeof pts === 'number' ? (pts > 1 ? `+${pts}` : `×${pts}`) : String(pts)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Enrichment / Website Analysis */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--fg-muted)', fontSize: 11 }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>⟳</div>
              Loading analysis…
            </div>
          ) : enrichment ? (
            <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Website Analysis</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                {[
                  { label: 'SITE STATUS', val: String(enrichment.siteStatus ?? 'unknown').toUpperCase(),
                    col: String(enrichment.siteStatus) === 'live' ? 'var(--success)' : 'var(--danger)' },
                  { label: 'CMS', val: String(enrichment.cms ?? 'Unknown') },
                  { label: 'QUALITY', val: String(enrichment.websiteQuality ?? 'unknown').toUpperCase() },
                  { label: 'AUTOMATION', val: String(enrichment.automationLevel ?? 'none').toUpperCase() },
                  { label: 'SSL', val: enrichment.hasSSL ? 'YES' : 'NO',
                    col: enrichment.hasSSL ? 'var(--success)' : 'var(--danger)' },
                  { label: 'MOBILE', val: enrichment.mobileFriendly ? 'YES' : 'NO',
                    col: enrichment.mobileFriendly ? 'var(--success)' : 'var(--danger)' },
                ].map(({ label, val, col }) => (
                  <div key={label}>
                    <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>{label}</div>
                    <div style={{ fontSize: 11, color: col ?? 'var(--fg)' }}>{val}</div>
                  </div>
                ))}
              </div>
              {Array.isArray(enrichment.techStack) && (enrichment.techStack as string[]).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>TECH STACK</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(enrichment.techStack as string[]).map((t, i) => (
                      <span key={i} style={{ fontSize: 9, padding: '1px 6px', border: '1px solid var(--border)', color: 'var(--fg-dim)', borderRadius: 2 }}>{t}</span>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(enrichment.automationSignals) && (enrichment.automationSignals as string[]).length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>AUTOMATION SIGNALS</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {(enrichment.automationSignals as string[]).map((s, i) => (
                      <span key={i} style={{ fontSize: 9, padding: '1px 6px', border: '1px solid var(--warm)', color: 'var(--warm)', borderRadius: 2 }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {enrichment.primaryPain && (
                <div style={{ padding: '8px 10px', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 3 }}>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 3 }}>PRIMARY PAIN</div>
                  <div style={{ fontSize: 11 }}>{String(enrichment.primaryPain)}</div>
                  {enrichment.pitchAngle && (
                    <>
                      <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginTop: 6, marginBottom: 2 }}>PITCH ANGLE</div>
                      <div style={{ fontSize: 11, color: 'var(--primary)' }}>{String(enrichment.pitchAngle)}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', padding: '12px 0' }}>
              No enrichment yet — lead will be analysed automatically.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main leads list ──────────────────────────────────────────────────────────

function LeadsList() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isMounted, setIsMounted]     = useState(false);
  const [leadsData, setLeadsData]     = useState<Lead[]>([]);
  const [pagination, setPagination]   = useState({ page: 1, limit: 50, total: 0, pages: 1 });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  const [opportunityLevel, setOpportunityLevel] = useState(searchParams?.get('opportunityLevel') ?? '');
  const [status, setStatus]   = useState('');
  const [search, setSearch]   = useState('');
  const [sortBy, setSortBy]   = useState('opportunityScore');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage]       = useState(1);

  const [outcomeModal, setOutcomeModal]         = useState<OutcomeModal | null>(null);
  const [outcomeVal, setOutcomeVal]             = useState('replied');
  const [channelVal, setChannelVal]             = useState('email');
  const [dealValue, setDealValue]               = useState('');
  const [outcomeError, setOutcomeError]         = useState('');
  const [outcomeSubmitting, setOutcomeSubmitting] = useState(false);

  const [detailLead, setDetailLead]           = useState<Lead | null>(null);
  const [detailEnrichment, setDetailEnrichment] = useState<Record<string, unknown> | null>(null);
  const [detailLoading, setDetailLoading]     = useState(false);
  const [updatingStatus, setUpdatingStatus]   = useState<string | null>(null);
  const [statusError, setStatusError]         = useState<string | null>(null);

  const fetchLeads = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    setLoading(true);
    setError(null);
    try {
      const filters: LeadFilters = { page, limit: 50, sortBy, sortDir };
      if (opportunityLevel) filters.opportunityLevel = opportunityLevel;
      if (status)           filters.status = status;
      if (search.trim())    filters.search = search.trim();
      const result = await leads.list(filters);
      setLeadsData(result.data);
      setPagination(result.pagination);
    } catch (err) {
      setError((err as Error).message || 'Failed to load leads. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, [router, page, opportunityLevel, status, search, sortBy, sortDir]);

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => { if (isMounted) fetchLeads(); }, [isMounted, fetchLeads]);

  // Handle Real-time Subscriptions
  useEffect(() => {
    if (!isMounted) return;
    const unsubscribe = subscribeLeads((newLead) => {
      setLeadsData(prev => {
        const index = prev.findIndex(l => l._id === newLead._id);
        if (index > -1) {
          const next = [...prev];
          next[index] = newLead;
          return next;
        }
        return [newLead, ...prev];
      });
    });
    return () => { unsubscribe(); };
  }, [isMounted]);

  async function openDetail(lead: Lead) {
    setDetailLead(lead);
    setDetailEnrichment(null);
    setDetailLoading(true);
    try {
      const res = await leads.get(lead._id);
      setDetailLead(res.lead);
      setDetailEnrichment(res.enrichment as Record<string, unknown>);
    } catch { /* keep existing data */ }
    finally { setDetailLoading(false); }
  }

  async function updateStatus(leadId: string, newStatus: string) {
    setUpdatingStatus(leadId);
    setStatusError(null);
    try {
      await leads.updateStatus(leadId, newStatus);
      setLeadsData(prev => prev.map(l => l._id === leadId ? { ...l, status: newStatus } : l));
    } catch (err) {
      setStatusError((err as Error).message);
      setTimeout(() => setStatusError(null), 3000);
    } finally { setUpdatingStatus(null); }
  }

  async function submitOutcome() {
    if (!outcomeModal) return;
    setOutcomeSubmitting(true);
    setOutcomeError('');
    try {
      await leads.logOutcome(outcomeModal.leadId, {
        actualOutcome: outcomeVal,
        replyQuality: 'none',
        channelUsed: channelVal,
        dealValue: dealValue ? Number(dealValue) : undefined,
      });
      setOutcomeModal(null);
      setDealValue('');
      fetchLeads();
    } catch (err) {
      setOutcomeError((err as Error).message || 'Failed to log outcome.');
    } finally { setOutcomeSubmitting(false); }
  }

  if (!isMounted) return null;

  return (
    <AppShell>
      {/* ── Page header + filters ─────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Lead Pipeline</h1>
          <div className="page-subtitle">
            {loading
              ? 'Loading leads…'
              : error
              ? <span style={{ color: 'var(--danger)' }}>{error}</span>
              : `${pagination.total.toLocaleString()} leads · sorted by ${sortBy}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={opportunityLevel} onChange={e => { setOpportunityLevel(e.target.value); setPage(1); }}>
            <option value="">ALL OPPS</option>
            {OPP_OPTIONS.map(o => <option key={o} value={o}>{OPP_EMOJI[o]} {o.toUpperCase()}</option>)}
          </select>
          <select className="input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>
            <option value="">ALL STATUS</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <select className="input" value={sortBy} onChange={e => { setSortBy(e.target.value); setPage(1); }}>
            <option value="opportunityScore">SORT: SCORE</option>
            <option value="createdAt">SORT: DATE ADDED</option>
            <option value="enrichedAt">SORT: ENRICHED</option>
          </select>
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }}
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}>
            {sortDir === 'desc' ? '↓ DESC' : '↑ ASC'}
          </button>
          <input
            className="input"
            placeholder="Search business / domain…"
            value={search}
            style={{ minWidth: 180 }}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={fetchLeads}>
            ↺
          </button>
        </div>
      </div>

      {statusError && (
        <div style={{ marginBottom: 8, padding: '8px 12px', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 11, borderRadius: 3 }}>
          {statusError}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 24, color: 'var(--danger)', marginBottom: 10 }}>[ ERROR ]</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16 }}>{error}</div>
            <button className="btn btn-primary" onClick={fetchLeads}>↺ RETRY</button>
          </div>
        ) : leadsData.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 28, color: 'var(--border-bright)', marginBottom: 12 }}>
              [ NO LEADS FOUND ]
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {search || opportunityLevel || status
                ? 'Try adjusting your filters'
                : 'Launch a search from the sidebar to start generating leads'}
            </div>
            {(search || opportunityLevel || status) && (
              <button className="btn btn-ghost" onClick={() => { setSearch(''); setOpportunityLevel(''); setStatus(''); }}>
                CLEAR FILTERS
              </button>
            )}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '26%' }}>Business</th>
                <th style={{ width: '18%' }}>Contact</th>
                <th style={{ width: '12%' }}>Score</th>
                <th style={{ width: '12%' }}>Opportunity</th>
                <th style={{ width: '12%' }}>Status</th>
                <th style={{ width: '20%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leadsData.map(lead => {
                const websiteUrl = lead.website ?? (lead.domain ? `https://${lead.domain}` : null);
                const rowBg = lead.opportunityLevel === 'high'
                  ? 'rgba(255,107,0,0.03)'
                  : lead.opportunityLevel === 'medium'
                  ? 'rgba(255,184,0,0.02)'
                  : 'transparent';

                return (
                  <tr
                    key={lead._id}
                    style={{ cursor: 'pointer', background: rowBg, transition: 'background 0.15s' }}
                    onClick={() => openDetail(lead)}
                  >
                    {/* Business name + domain */}
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{lead.businessName}</div>
                      <div style={{ fontSize: 9, opacity: 0.45, fontFamily: "'Share Tech Mono', monospace" }}>{lead.domain}</div>
                      {lead.industry && (
                        <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginTop: 1 }}>{lead.industry}</div>
                      )}
                    </td>

                    {/* Contact */}
                    <td>
                      <ContactCell email={lead.email} phone={lead.phone} />
                    </td>

                    {/* Score bar */}
                    <td>
                      <ScoreBar score={lead.opportunityScore} level={lead.opportunityLevel} />
                    </td>

                    {/* Opportunity badge */}
                    <td>
                      <OpportunityBadge level={lead.opportunityLevel} />
                    </td>

                    {/* Status dropdown */}
                    <td onClick={e => e.stopPropagation()}>
                      <select
                        className="input"
                        style={{ fontSize: 9, padding: '2px 4px', width: '100%' }}
                        value={lead.status}
                        onChange={e => updateStatus(lead._id, e.target.value)}
                        disabled={updatingStatus === lead._id}
                      >
                        {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                      </select>
                    </td>

                    {/* Action buttons */}
                    <td onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {/* Visit button */}
                        {websiteUrl && (
                          <a
                            href={websiteUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-ghost"
                            style={{ fontSize: 9, padding: '2px 7px', textDecoration: 'none', color: 'var(--primary)', borderColor: 'var(--primary)' }}
                            title={`Open ${websiteUrl}`}
                          >
                            🌐 VISIT
                          </a>
                        )}
                        {/* Log outcome */}
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: 9, padding: '2px 7px' }}
                          onClick={() => {
                            setOutcomeVal('replied');
                            setChannelVal('email');
                            setDealValue('');
                            setOutcomeError('');
                            setOutcomeModal({ leadId: lead._id, businessName: lead.businessName });
                          }}
                        >
                          LOG
                        </button>
                        {/* Details */}
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 9, padding: '2px 7px' }}
                          onClick={() => openDetail(lead)}
                        >
                          INFO
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────────── */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}
            onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
            ← PREV
          </button>
          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--fg-muted)' }}>
            {page} / {pagination.pages} · {pagination.total.toLocaleString()} leads
          </span>
          <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}
            onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}>
            NEXT →
          </button>
        </div>
      )}

      {/* ── Lead detail modal ──────────────────────────────────────────────── */}
      {detailLead && (
        <LeadDetailModal
          lead={detailLead}
          enrichment={detailEnrichment}
          loading={detailLoading}
          onClose={() => { setDetailLead(null); setDetailEnrichment(null); }}
        />
      )}

      {/* ── Log outcome modal ──────────────────────────────────────────────── */}
      {outcomeModal && (
        <div className="modal-overlay" onClick={() => setOutcomeModal(null)}>
          <div className="modal-content" style={{ width: 340 }} onClick={e => e.stopPropagation()}>
            <div className="panel-header">
              <span className="panel-title">Log Outcome</span>
              <span style={{ fontSize: 10, color: 'var(--fg-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {outcomeModal.businessName}
              </span>
            </div>
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>OUTCOME</div>
                <select className="input" value={outcomeVal} onChange={e => setOutcomeVal(e.target.value)}>
                  {OUTCOME_OPTIONS.map(o => <option key={o} value={o}>{o.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>CHANNEL</div>
                <select className="input" value={channelVal} onChange={e => setChannelVal(e.target.value)}>
                  {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
                </select>
              </div>
              {outcomeVal === 'converted' && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>DEAL VALUE (USD)</div>
                  <input className="input" type="number" min="0" placeholder="e.g. 2500"
                    value={dealValue} onChange={e => setDealValue(e.target.value)} />
                </div>
              )}
              {outcomeError && (
                <div style={{ fontSize: 10, color: 'var(--danger)', padding: '6px 8px', border: '1px solid var(--danger)', borderRadius: 3 }}>
                  {outcomeError}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={submitOutcome} disabled={outcomeSubmitting}>
                  {outcomeSubmitting ? 'SAVING…' : 'SUBMIT'}
                </button>
                <button className="btn btn-ghost" onClick={() => setOutcomeModal(null)}>CANCEL</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

// ── Page export with Suspense boundary ───────────────────────────────────────

export default function LeadsPage() {
  return (
    <Suspense fallback={
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', flexDirection: 'column', gap: 12,
        fontFamily: "'Share Tech Mono', monospace", color: 'var(--fg-muted)', fontSize: 13,
        background: 'var(--bg)',
      }}>
        <div style={{ fontSize: 32, animation: 'blink 1s step-end infinite' }}>⟳</div>
        LOADING LEAD PIPELINE…
      </div>
    }>
      <LeadsList />
    </Suspense>
  );
}
