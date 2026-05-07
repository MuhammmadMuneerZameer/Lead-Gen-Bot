"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { campaigns, getToken, type Campaign } from '../lib/api';
import AppShell from '../components/AppShell';

const STATUS_COLOR: Record<string, string> = {
  draft:     'var(--fg-muted)',
  active:    'var(--success)',
  paused:    'var(--warm)',
  completed: 'var(--cold)',
};

const CHANNEL_OPTIONS  = ['email', 'linkedin', 'phone', 'whatsapp', 'other'];
const STATUS_OPTIONS   = ['draft', 'active', 'paused', 'completed'];
const PRIORITY_OPTIONS = ['high', 'medium', 'low'];

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? 'var(--fg-muted)';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px',
      fontSize: 9, fontFamily: "'Share Tech Mono', monospace", fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase',
      border: `1px solid ${color}`, color, borderRadius: 3,
      background: `${color}18`,
    }}>
      {status}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div style={{ padding: '8px 0' }}>
      {[...Array(5)].map((_, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, padding: '14px 16px',
          borderBottom: '1px solid var(--border)', opacity: 1 - i * 0.15,
        }}>
          <div style={{ flex: 2, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 0.8, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1.5, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 0.5, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
        </div>
      ))}
    </div>
  );
}

// ── Campaign detail modal ─────────────────────────────────────────────────────

function CampaignDetailModal({ campaign, recentOutreach, loading, onClose }: {
  campaign: Campaign;
  recentOutreach: unknown[];
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: 520, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="panel-header" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1, gap: 8 }}>
          <span className="panel-title" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {campaign.name}
          </span>
          <StatusBadge status={campaign.status} />
          <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 10 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Channel + limits */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, color: 'var(--fg-dim)', padding: '2px 8px', border: '1px solid var(--border)', borderRadius: 2 }}>
              {campaign.channel.toUpperCase()}
            </span>
            <span style={{ fontSize: 10, color: 'var(--fg-dim)' }}>
              Daily limit: <strong style={{ color: 'var(--fg)' }}>{campaign.dailyLimit}</strong>
            </span>
            {campaign.startedAt && (
              <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                Started {new Date(campaign.startedAt).toLocaleDateString()}
              </span>
            )}
            {campaign.completedAt && (
              <span style={{ fontSize: 9, color: 'var(--cold)' }}>
                Completed {new Date(campaign.completedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          {campaign.description && (
            <div style={{ fontSize: 11, color: 'var(--fg-dim)', fontStyle: 'italic' }}>{campaign.description}</div>
          )}

          {/* Stats */}
          <div className="panel" style={{ padding: 16, marginBottom: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Performance</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
              {[
                { label: 'Sent',      value: campaign.stats.totalSent,                              color: 'var(--fg)' },
                { label: 'Replied',   value: campaign.stats.totalReplied,                           color: 'var(--warm)' },
                { label: 'Converted', value: campaign.stats.totalConverted,                         color: 'var(--success)' },
                { label: 'Reply %',   value: `${(campaign.stats.replyRate * 100).toFixed(1)}%`,     color: 'var(--primary)' },
                { label: 'Conv %',    value: `${(campaign.stats.conversionRate * 100).toFixed(1)}%`, color: 'var(--success)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 16, color, fontWeight: 600 }}>{value}</div>
                  <div style={{ fontSize: 8, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Targeting */}
          {((campaign.targetPriorities?.length ?? 0) > 0 || (campaign.targetIndustries?.length ?? 0) > 0) && (
            <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
              <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Targeting</div>
              {(campaign.targetPriorities?.length ?? 0) > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>PRIORITIES</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {campaign.targetPriorities.map(p => (
                      <span key={p} style={{ fontSize: 9, padding: '1px 6px', border: '1px solid var(--primary)', color: 'var(--primary)', borderRadius: 2 }}>{p}</span>
                    ))}
                  </div>
                </div>
              )}
              {(campaign.targetIndustries?.length ?? 0) > 0 && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>INDUSTRIES</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {campaign.targetIndustries.map(ind => (
                      <span key={ind} style={{ fontSize: 9, padding: '1px 6px', border: '1px solid var(--border)', color: 'var(--fg-dim)', borderRadius: 2 }}>{ind}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recent outreach */}
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent Outreach</div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--fg-muted)', fontSize: 11 }}>⟳ Loading…</div>
            ) : recentOutreach.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--fg-muted)', textAlign: 'center', padding: '12px 0' }}>No outreach logged yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {(recentOutreach as Record<string, unknown>[]).slice(0, 6).map((item, i) => {
                  const lead = typeof item.leadId === 'object' && item.leadId !== null
                    ? (item.leadId as Record<string, unknown>)
                    : null;
                  const status = String(item.status ?? 'unknown');
                  const statusColor = STATUS_COLOR[status] ?? 'var(--fg-muted)';
                  return (
                    <div key={i} className="panel" style={{ padding: '8px 12px', marginBottom: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontWeight: 600 }}>
                          {lead ? String(lead.businessName ?? 'Lead') : 'Lead'}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>
                          {item.sentAt ? new Date(String(item.sentAt)).toLocaleDateString() : '—'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <span style={{ fontSize: 9, border: '1px solid var(--border)', color: 'var(--fg-muted)', padding: '1px 5px', borderRadius: 2 }}>
                          {String(item.channel ?? '—')}
                        </span>
                        <span style={{ fontSize: 9, border: `1px solid ${statusColor}`, color: statusColor, padding: '1px 5px', borderRadius: 2 }}>
                          {status}
                        </span>
                      </div>
                      {item.messageSent && (
                        <div style={{ fontSize: 10, color: 'var(--fg-dim)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(item.messageSent).slice(0, 90)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create campaign modal ─────────────────────────────────────────────────────

function CreateCampaignModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (campaign: Campaign) => void;
}) {
  const [name, setName]               = useState('');
  const [description, setDesc]        = useState('');
  const [channel, setChannel]         = useState('email');
  const [industries, setIndustries]   = useState('');
  const [priorities, setPriorities]   = useState<string[]>(['high']);
  const [dailyLimit, setDailyLimit]   = useState('20');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');

  async function submit() {
    if (!name.trim()) { setError('Campaign name is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await campaigns.create({
        name: name.trim(),
        description: description.trim() || undefined,
        channel,
        targetIndustries: industries.split(',').map(s => s.trim()).filter(Boolean),
        targetPriorities: priorities,
        dailyLimit: Number(dailyLimit) || 20,
      });
      onCreate(res.campaign);
    } catch (err) {
      setError((err as Error).message || 'Failed to create campaign');
    } finally {
      setSubmitting(false);
    }
  }

  function togglePriority(p: string) {
    setPriorities(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ width: 400 }} onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">New Campaign</span>
          <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 10 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>NAME *</div>
            <input className="input" placeholder="e.g. Q2 Local Restaurant Outreach" value={name}
              onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>DESCRIPTION</div>
            <input className="input" placeholder="Optional description" value={description}
              onChange={e => setDesc(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>CHANNEL</div>
            <select className="input" value={channel} onChange={e => setChannel(e.target.value)}>
              {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 6 }}>TARGET PRIORITIES</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {PRIORITY_OPTIONS.map(p => (
                <button key={p} type="button" onClick={() => togglePriority(p)} style={{
                  padding: '3px 12px', fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
                  border: `1px solid ${priorities.includes(p) ? 'var(--primary)' : 'var(--border)'}`,
                  background: priorities.includes(p) ? 'var(--primary-dim)' : 'transparent',
                  color: priorities.includes(p) ? 'var(--primary)' : 'var(--fg-muted)',
                  borderRadius: 3, cursor: 'pointer',
                }}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>TARGET INDUSTRIES (comma-separated)</div>
            <input className="input" placeholder="e.g. restaurants, salons, gyms" value={industries}
              onChange={e => setIndustries(e.target.value)} />
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>DAILY LIMIT</div>
            <input className="input" type="number" min="1" max="500" value={dailyLimit}
              onChange={e => setDailyLimit(e.target.value)} />
          </div>
          {error && (
            <div style={{ fontSize: 10, color: 'var(--danger)', padding: '6px 8px', border: '1px solid var(--danger)', borderRadius: 3 }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={submitting}>
              {submitting ? 'CREATING…' : 'CREATE CAMPAIGN'}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter();
  const [isMounted, setIsMounted]       = useState(false);
  const [campaignList, setCampaignList] = useState<Campaign[]>([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch]             = useState('');

  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [detailOutreach, setDetailOutreach] = useState<unknown[]>([]);
  const [detailLoading, setDetailLoading]   = useState(false);
  const [showCreate, setShowCreate]         = useState(false);
  const [deletingId, setDeletingId]         = useState<string | null>(null);
  const [togglingId, setTogglingId]         = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await campaigns.list(statusFilter || undefined);
      setCampaignList(res.data);
    } catch (err) {
      setError((err as Error).message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [router, statusFilter]);

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => {
    if (!isMounted) return;
    fetchCampaigns();
    const id = setInterval(fetchCampaigns, 30000);
    return () => clearInterval(id);
  }, [isMounted, fetchCampaigns]);

  async function openDetail(campaign: Campaign) {
    setDetailCampaign(campaign);
    setDetailOutreach([]);
    setDetailLoading(true);
    try {
      const res = await campaigns.get(campaign._id);
      setDetailCampaign(res.campaign);
      setDetailOutreach(res.recentOutreach);
    } catch { /* keep existing data */ }
    finally { setDetailLoading(false); }
  }

  async function toggleStatus(campaign: Campaign) {
    const next = campaign.status === 'active' ? 'paused' : 'active';
    setTogglingId(campaign._id);
    try {
      const res = await campaigns.updateStatus(campaign._id, next);
      setCampaignList(prev => prev.map(c => c._id === campaign._id ? res.campaign : c));
    } catch { /* silently fail */ }
    finally { setTogglingId(null); }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    setDeletingId(id);
    try {
      await campaigns.delete(id);
      setCampaignList(prev => prev.filter(c => c._id !== id));
    } catch { /* silently fail */ }
    finally { setDeletingId(null); }
  }

  const filtered = campaignList.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!isMounted) return null;

  return (
    <AppShell>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Outreach Campaigns</h1>
          <div className="page-subtitle">
            {loading ? 'Loading…' : error
              ? <span style={{ color: 'var(--danger)' }}>{error}</span>
              : `${filtered.length} campaign${filtered.length !== 1 ? 's' : ''}${statusFilter ? ` · ${statusFilter}` : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">ALL STATUS</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <input className="input" placeholder="Search campaigns…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ minWidth: 160 }} />
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={fetchCampaigns}>↺</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ NEW CAMPAIGN</button>
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 24, color: 'var(--danger)', marginBottom: 10 }}>[ ERROR ]</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16 }}>{error}</div>
            <button className="btn btn-primary" onClick={fetchCampaigns}>↺ RETRY</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12, color: 'var(--fg-muted)' }}>◈</div>
            <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 8, letterSpacing: '0.1em' }}>
              {search || statusFilter ? '[ NO MATCHES ]' : '[ NO CAMPAIGNS YET ]'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)', marginBottom: 16 }}>
              {search || statusFilter
                ? 'Try adjusting your filters'
                : 'Create your first campaign to start outreach sequences'}
            </div>
            {!search && !statusFilter && (
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ CREATE CAMPAIGN</button>
            )}
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '24%' }}>Campaign</th>
                <th style={{ width: '9%' }}>Channel</th>
                <th style={{ width: '10%' }}>Status</th>
                <th style={{ width: '30%' }}>Stats</th>
                <th style={{ width: '8%' }}>Limit/day</th>
                <th style={{ width: '19%' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c._id} style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                  onClick={() => openDetail(c)}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{c.name}</div>
                    {c.description && (
                      <div style={{ fontSize: 9, color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                        {c.description}
                      </div>
                    )}
                    <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginTop: 1, fontFamily: "'Share Tech Mono', monospace" }}>
                      {new Date(c.createdAt).toLocaleDateString()}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 9, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {c.channel}
                    </span>
                  </td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>
                    <div style={{ display: 'flex', gap: 14 }}>
                      {[
                        { label: 'sent',    val: c.stats.totalSent,                              col: 'var(--fg)' },
                        { label: 'replied', val: c.stats.totalReplied,                           col: 'var(--warm)' },
                        { label: 'conv.',   val: c.stats.totalConverted,                         col: 'var(--success)' },
                        { label: 'reply%',  val: `${(c.stats.replyRate * 100).toFixed(1)}%`,     col: 'var(--primary)' },
                      ].map(({ label, val, col }) => (
                        <div key={label} style={{ textAlign: 'center' }}>
                          <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, color: col }}>{val}</div>
                          <div style={{ fontSize: 8, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>{c.dailyLimit}</span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        className="btn btn-ghost"
                        style={{
                          fontSize: 9, padding: '2px 7px',
                          color: c.status === 'active' ? 'var(--warm)' : 'var(--success)',
                          borderColor: c.status === 'active' ? 'var(--warm)' : 'var(--success)',
                        }}
                        disabled={togglingId === c._id || c.status === 'completed' || c.status === 'draft'}
                        onClick={() => toggleStatus(c)}
                      >
                        {togglingId === c._id ? '…' : c.status === 'active' ? '⏸ PAUSE' : '▶ START'}
                      </button>
                      <button className="btn btn-ghost" style={{ fontSize: 9, padding: '2px 7px' }}
                        onClick={() => openDetail(c)}>
                        INFO
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 9, padding: '2px 7px', color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        disabled={deletingId === c._id}
                        onClick={() => deleteCampaign(c._id)}
                      >
                        {deletingId === c._id ? '…' : '✕'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreate={campaign => {
            setCampaignList(prev => [campaign, ...prev]);
            setShowCreate(false);
          }}
        />
      )}

      {detailCampaign && (
        <CampaignDetailModal
          campaign={detailCampaign}
          recentOutreach={detailOutreach}
          loading={detailLoading}
          onClose={() => { setDetailCampaign(null); setDetailOutreach([]); }}
        />
      )}
    </AppShell>
  );
}
