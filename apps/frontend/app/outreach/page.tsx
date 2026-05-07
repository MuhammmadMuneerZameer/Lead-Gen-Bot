"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { outreach, leads as leadsApi, getToken, type OutreachLog, type Lead } from '../lib/api';
import AppShell from '../components/AppShell';

const STATUS_COLOR: Record<string, string> = {
  pending:   'var(--fg-muted)',
  sent:      'var(--cold)',
  opened:    'var(--warm)',
  replied:   'var(--success)',
  bounced:   'var(--danger)',
  converted: 'var(--primary)',
};

const CHANNEL_OPTIONS = ['email', 'linkedin', 'phone', 'whatsapp', 'other'];
const STATUS_OPTIONS  = ['pending', 'sent', 'opened', 'replied', 'bounced', 'converted'];

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
      {[...Array(8)].map((_, i) => (
        <div key={i} style={{
          display: 'flex', gap: 12, padding: '12px 16px',
          borderBottom: '1px solid var(--border)', opacity: 1 - i * 0.1,
        }}>
          <div style={{ flex: 2, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 0.8, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1.5, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
          <div style={{ flex: 1, height: 14, background: 'var(--surface-2)', borderRadius: 3 }} />
        </div>
      ))}
    </div>
  );
}

// ── New outreach modal ────────────────────────────────────────────────────────

function NewOutreachModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (log: OutreachLog) => void;
}) {
  const [search, setSearch]         = useState('');
  const [results, setResults]       = useState<Lead[]>([]);
  const [selectedLead, setSelected] = useState<Lead | null>(null);
  const [searching, setSearching]   = useState(false);
  const [channel, setChannel]       = useState('email');
  const [message, setMessage]       = useState('');
  const [followUp, setFollowUp]     = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function searchLeads(q: string) {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);
    try {
      const res = await leadsApi.list({ search: q.trim(), limit: 8 });
      setResults(res.data);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }

  useEffect(() => {
    const t = setTimeout(() => searchLeads(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  async function submit() {
    if (!selectedLead) { setError('Select a lead first'); return; }
    if (!message.trim()) { setError('Message is required'); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await outreach.create({
        leadId: selectedLead._id,
        channel,
        messageSent: message.trim(),
        followUpDate: followUp || undefined,
      });
      onCreate(res.outreach);
    } catch (err) {
      setError((err as Error).message || 'Failed to log outreach');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <div className="panel-header">
          <span className="panel-title">Log New Outreach</span>
          <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 10 }} onClick={onClose}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Lead search */}
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>LEAD *</div>
            {selectedLead ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--success)', borderRadius: 3, background: 'rgba(0,255,136,0.05)' }}>
                <span style={{ flex: 1, fontSize: 11, fontWeight: 600 }}>{selectedLead.businessName}</span>
                <span style={{ fontSize: 9, color: 'var(--fg-muted)', fontFamily: "'Share Tech Mono', monospace" }}>{selectedLead.domain}</span>
                <button className="btn btn-ghost" style={{ fontSize: 9, padding: '1px 6px' }} onClick={() => { setSelected(null); setSearch(''); }}>✕</button>
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input
                  className="input"
                  placeholder="Search by business name or domain…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                />
                {(results.length > 0 || searching) && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 4px 4px', maxHeight: 200, overflowY: 'auto' }}>
                    {searching ? (
                      <div style={{ padding: '10px 12px', fontSize: 10, color: 'var(--fg-muted)' }}>Searching…</div>
                    ) : results.map(lead => (
                      <div
                        key={lead._id}
                        style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        onClick={() => { setSelected(lead); setResults([]); setSearch(''); }}
                      >
                        <span style={{ flex: 1, fontSize: 11, fontWeight: 600 }}>{lead.businessName}</span>
                        <span style={{ fontSize: 9, color: 'var(--fg-muted)', fontFamily: "'Share Tech Mono', monospace" }}>{lead.domain}</span>
                        <span style={{ fontSize: 9, color: lead.opportunityLevel === 'high' ? 'var(--primary)' : lead.opportunityLevel === 'medium' ? 'var(--warm)' : 'var(--cold)' }}>
                          {lead.opportunityScore}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Channel + follow-up */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>CHANNEL</div>
              <select className="input" value={channel} onChange={e => setChannel(e.target.value)}>
                {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>FOLLOW-UP DATE</div>
              <input className="input" type="date" value={followUp} onChange={e => setFollowUp(e.target.value)} />
            </div>
          </div>

          {/* Message */}
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 4 }}>MESSAGE SENT *</div>
            <textarea
              className="input"
              placeholder="Paste the message you sent…"
              value={message}
              onChange={e => setMessage(e.target.value)}
              style={{ minHeight: 100, resize: 'vertical', fontFamily: 'inherit', fontSize: 11 }}
            />
          </div>

          {error && (
            <div style={{ fontSize: 10, color: 'var(--danger)', padding: '6px 8px', border: '1px solid var(--danger)', borderRadius: 3 }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={submitting}>
              {submitting ? 'SAVING…' : 'SAVE LOG'}
            </button>
            <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Outreach detail modal ─────────────────────────────────────────────────────

function OutreachDetailModal({ log, onClose, onStatusUpdate }: {
  log: OutreachLog;
  onClose: () => void;
  onStatusUpdate: (id: string, status: string, response?: string) => Promise<void>;
}) {
  const [newStatus, setNewStatus] = useState(log.status);
  const [response, setResponse]   = useState(log.response ?? '');
  const [updating, setUpdating]   = useState(false);
  const [error, setError]         = useState('');

  const lead = typeof log.leadId === 'object' ? log.leadId : null;

  async function submit() {
    if (newStatus === log.status && !response.trim()) { onClose(); return; }
    setUpdating(true);
    setError('');
    try {
      await onStatusUpdate(log._id, newStatus, response.trim() || undefined);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to update');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ width: 480, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="panel-header" style={{ position: 'sticky', top: 0, background: 'var(--surface)', zIndex: 1, gap: 8 }}>
          <span className="panel-title" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {lead ? lead.businessName : 'Outreach Detail'}
          </span>
          <StatusBadge status={log.status} />
          <button className="btn btn-ghost" style={{ padding: '3px 8px', fontSize: 10 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Meta */}
          <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>CHANNEL</div>
                <div style={{ fontSize: 11, textTransform: 'uppercase' }}>{log.channel}</div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>SENT AT</div>
                <div style={{ fontSize: 11 }}>{log.sentAt ? new Date(log.sentAt).toLocaleString() : '—'}</div>
              </div>
              {log.openedAt && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>OPENED AT</div>
                  <div style={{ fontSize: 11, color: 'var(--warm)' }}>{new Date(log.openedAt).toLocaleString()}</div>
                </div>
              )}
              {log.repliedAt && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>REPLIED AT</div>
                  <div style={{ fontSize: 11, color: 'var(--success)' }}>{new Date(log.repliedAt).toLocaleString()}</div>
                </div>
              )}
              {log.followUpDate && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>FOLLOW-UP DUE</div>
                  <div style={{ fontSize: 11, color: 'var(--primary)' }}>{new Date(log.followUpDate).toLocaleDateString()}</div>
                </div>
              )}
              {lead && (
                <div>
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)' }}>LEAD SCORE</div>
                  <div style={{ fontSize: 11, fontFamily: "'Share Tech Mono', monospace" }}>{lead.score}</div>
                </div>
              )}
            </div>
          </div>

          {/* Message sent */}
          <div className="panel" style={{ padding: 12, marginBottom: 0 }}>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Message Sent</div>
            <div style={{ fontSize: 11, color: 'var(--fg-dim)', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 160, overflowY: 'auto' }}>
              {log.messageSent || '—'}
            </div>
          </div>

          {/* Reply received */}
          {log.response && (
            <div className="panel" style={{ padding: 12, marginBottom: 0, border: '1px solid var(--success)' }}>
              <div style={{ fontSize: 9, color: 'var(--success)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Reply Received</div>
              <div style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{log.response}</div>
            </div>
          )}

          {/* Update status */}
          <div>
            <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Update Status</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <select className="input" value={newStatus} onChange={e => setNewStatus(e.target.value)}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
              </select>
              {(newStatus === 'replied' || newStatus === 'converted') && (
                <textarea
                  className="input"
                  placeholder="Paste their reply here…"
                  value={response}
                  onChange={e => setResponse(e.target.value)}
                  style={{ minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
                />
              )}
              {error && (
                <div style={{ fontSize: 10, color: 'var(--danger)', padding: '6px 8px', border: '1px solid var(--danger)', borderRadius: 3 }}>
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={submit} disabled={updating}>
                  {updating ? 'SAVING…' : 'UPDATE STATUS'}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>CLOSE</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OutreachPage() {
  const router = useRouter();
  const [isMounted, setIsMounted]   = useState(false);
  const [logs, setLogs]             = useState<OutreachLog[]>([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 });
  const [followups, setFollowups]   = useState<OutreachLog[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [statusFilter, setStatusFilter]   = useState('');
  const [channelFilter, setChannelFilter] = useState('');
  const [page, setPage]                   = useState(1);
  const [detailLog, setDetailLog]         = useState<OutreachLog | null>(null);
  const [showNewLog, setShowNewLog]       = useState(false);

  const fetchLogs = useCallback(async () => {
    const token = getToken();
    if (!token) { router.replace('/login'); return; }
    setLoading(true);
    setError(null);
    try {
      const [logsRes, fuRes] = await Promise.all([
        outreach.list({ page, limit: 50, status: statusFilter || undefined, channel: channelFilter || undefined }),
        outreach.pendingFollowups(),
      ]);
      setLogs(logsRes.data);
      setPagination(logsRes.pagination);
      setFollowups(fuRes.data);
    } catch (err) {
      setError((err as Error).message || 'Failed to load outreach logs');
    } finally {
      setLoading(false);
    }
  }, [router, page, statusFilter, channelFilter]);

  useEffect(() => { setIsMounted(true); }, []);
  useEffect(() => {
    if (!isMounted) return;
    fetchLogs();
    const id = setInterval(fetchLogs, 30000);
    return () => clearInterval(id);
  }, [isMounted, fetchLogs]);

  async function handleStatusUpdate(id: string, status: string, response?: string) {
    const res = await outreach.updateStatus(id, status, response);
    setLogs(prev => prev.map(l => l._id === id ? res.outreach : l));
    setFollowups(prev => prev.filter(l => l._id !== id));
  }

  function leadName(log: OutreachLog): string {
    if (typeof log.leadId === 'object' && log.leadId) return log.leadId.businessName;
    return 'Unknown Lead';
  }

  function leadDomain(log: OutreachLog): string | null {
    if (typeof log.leadId === 'object' && log.leadId) return log.leadId.domain;
    return null;
  }

  if (!isMounted) return null;

  return (
    <AppShell>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Outreach Live Feed</h1>
          <div className="page-subtitle">
            {loading ? 'Loading…' : error
              ? <span style={{ color: 'var(--danger)' }}>{error}</span>
              : `${pagination.total.toLocaleString()} messages · ${followups.length} follow-up${followups.length !== 1 ? 's' : ''} due`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <select className="input" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">ALL STATUS</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}
          </select>
          <select className="input" value={channelFilter} onChange={e => { setChannelFilter(e.target.value); setPage(1); }}>
            <option value="">ALL CHANNELS</option>
            {CHANNEL_OPTIONS.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: 10 }} onClick={fetchLogs}>↺</button>
          <button className="btn btn-primary" onClick={() => setShowNewLog(true)}>+ LOG OUTREACH</button>
        </div>
      </div>

      {/* ── Pending follow-ups banner ─────────────────────────────────────────── */}
      {!loading && followups.length > 0 && (
        <div style={{
          marginBottom: 12, padding: '10px 16px',
          border: '1px solid var(--warm)', borderRadius: 4,
          background: 'rgba(255,214,0,0.05)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, color: 'var(--warm)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            ⚡ {followups.length} FOLLOW-UP{followups.length !== 1 ? 'S' : ''} DUE
          </span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {followups.slice(0, 4).map(f => (
              <button
                key={f._id}
                className="btn btn-ghost"
                style={{ fontSize: 9, padding: '2px 8px', borderColor: 'var(--warm)', color: 'var(--warm)' }}
                onClick={() => setDetailLog(f)}
              >
                {leadName(f)}
              </button>
            ))}
            {followups.length > 4 && (
              <span style={{ fontSize: 9, color: 'var(--fg-muted)', alignSelf: 'center' }}>
                +{followups.length - 4} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Share Tech Mono'", fontSize: 24, color: 'var(--danger)', marginBottom: 10 }}>[ ERROR ]</div>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginBottom: 16 }}>{error}</div>
            <button className="btn btn-primary" onClick={fetchLogs}>↺ RETRY</button>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '64px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12, color: 'var(--fg-muted)' }}>◈</div>
            <div style={{ fontSize: 13, color: 'var(--fg)', marginBottom: 8, letterSpacing: '0.1em' }}>
              {statusFilter || channelFilter ? '[ NO MATCHES ]' : '[ NO OUTREACH ACTIVITY YET ]'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {statusFilter || channelFilter
                ? 'Try adjusting your filters'
                : 'Messages will appear here once the outreach engine starts processing leads'}
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: '20%' }}>Lead</th>
                <th style={{ width: '9%' }}>Channel</th>
                <th style={{ width: '11%' }}>Status</th>
                <th style={{ width: '32%' }}>Message Preview</th>
                <th style={{ width: '14%' }}>Sent</th>
                <th style={{ width: '14%' }}>Follow-up</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const isFollowupDue = followups.some(f => f._id === log._id);
                return (
                  <tr
                    key={log._id}
                    style={{
                      cursor: 'pointer',
                      background: isFollowupDue ? 'rgba(255,214,0,0.04)' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => setDetailLog(log)}
                  >
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{leadName(log)}</div>
                      {leadDomain(log) && (
                        <div style={{ fontSize: 9, color: 'var(--fg-muted)', fontFamily: "'Share Tech Mono', monospace" }}>
                          {leadDomain(log)}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ fontSize: 9, color: 'var(--fg-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {log.channel}
                      </span>
                    </td>
                    <td><StatusBadge status={log.status} /></td>
                    <td>
                      <div style={{ fontSize: 10, color: 'var(--fg-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}>
                        {log.messageSent ? log.messageSent.slice(0, 90) : '—'}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: 'var(--fg-muted)' }}>
                        {log.sentAt ? new Date(log.sentAt).toLocaleDateString() : '—'}
                      </div>
                    </td>
                    <td>
                      {log.followUpDate ? (
                        <div style={{ fontSize: 10, fontFamily: "'Share Tech Mono', monospace", color: isFollowupDue ? 'var(--warm)' : 'var(--fg-muted)' }}>
                          {new Date(log.followUpDate).toLocaleDateString()}
                          {isFollowupDue && <span style={{ marginLeft: 4 }}>⚡</span>}
                        </div>
                      ) : (
                        <span style={{ fontSize: 9, color: 'var(--fg-muted)' }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────────── */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, alignItems: 'center' }}>
          <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}
            onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
            ← PREV
          </button>
          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'var(--fg-muted)' }}>
            {page} / {pagination.pages} · {pagination.total.toLocaleString()} messages
          </span>
          <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: 10 }}
            onClick={() => setPage(p => Math.min(pagination.pages, p + 1))} disabled={page >= pagination.pages}>
            NEXT →
          </button>
        </div>
      )}

      {/* ── Detail modal ─────────────────────────────────────────────────────── */}
      {detailLog && (
        <OutreachDetailModal
          log={detailLog}
          onClose={() => setDetailLog(null)}
          onStatusUpdate={handleStatusUpdate}
        />
      )}

      {/* ── New outreach modal ────────────────────────────────────────────────── */}
      {showNewLog && (
        <NewOutreachModal
          onClose={() => setShowNewLog(false)}
          onCreate={log => {
            setLogs(prev => [log, ...prev]);
            setShowNewLog(false);
          }}
        />
      )}
    </AppShell>
  );
}
