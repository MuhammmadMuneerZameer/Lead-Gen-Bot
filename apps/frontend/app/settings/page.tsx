"use client";

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { settings, getToken, clearToken } from '../lib/api';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Leads', href: '/leads' },
  { label: 'Campaigns', href: '/campaigns' },
  { label: 'Outreach', href: '/outreach' },
  { label: 'Analytics', href: '/analytics' },
  { label: 'Optimizer', href: '/optimizer' },
  { label: 'Settings', href: '/settings' },
];

const WEIGHT_FACTORS = [
  'hasWebsite',
  'websiteQuality',
  'hasSocialProof',
  'hasBookingSystem',
  'hasChatbot',
  'hasContactForm',
  'hasEcommerce',
  'automationLevel',
  'techStackAge',
  'seoScore',
  'performanceScore',
  'industryTier',
];

interface ScoringConfig {
  _id: string;
  version: number;
  active: boolean;
  weights: Record<string, number>;
  changeLog?: string;
  createdAt: string;
}

interface PromptTemplate {
  _id: string;
  type: string;
  version: number;
  active: boolean;
  template: string;
  industry?: string;
  notes?: string;
  replyRate?: number;
  sampleCount?: number;
  createdAt: string;
}

type Tab = 'scoring' | 'prompts';

export default function SettingsPage() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [time, setTime] = useState('');
  const [currentPath, setCurrentPath] = useState('/settings');
  const [tab, setTab] = useState<Tab>('scoring');

  // Scoring
  const [activeConfig, setActiveConfig] = useState<ScoringConfig | null>(null);
  const [allConfigs, setAllConfigs] = useState<ScoringConfig[]>([]);
  const [editedWeights, setEditedWeights] = useState<Record<string, number>>({});
  const [changeLog, setChangeLog] = useState('');
  const [savingWeights, setSavingWeights] = useState(false);
  const [weightMsg, setWeightMsg] = useState('');

  // Prompts
  const [promptList, setPromptList] = useState<PromptTemplate[]>([]);
  const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(null);
  const [editedTemplate, setEditedTemplate] = useState('');
  const [editedNotes, setEditedNotes] = useState('');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptMsg, setPromptMsg] = useState('');

  const fetchScoring = useCallback(async () => {
    try {
      const [active, all] = await Promise.all([
        settings.activeScoringConfig(),
        settings.allScoringConfigs(),
      ]);
      const cfg = active as unknown as ScoringConfig;
      setActiveConfig(cfg);
      setEditedWeights({ ...((cfg.weights as Record<string, number>) ?? {}) });
      setAllConfigs((all as { data: ScoringConfig[] }).data ?? []);
    } catch {
      // silent
    }
  }, []);

  const fetchPrompts = useCallback(async () => {
    try {
      const res = await settings.prompts();
      setPromptList((res.data as PromptTemplate[]) ?? []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    setIsMounted(true);
    setCurrentPath(window.location.pathname);
    const tick = () => setTime(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    tick();
    const id = setInterval(tick, 1000);

    const token = getToken();
    if (!token) { router.replace('/login'); return; }

    fetchScoring();
    fetchPrompts();

    return () => clearInterval(id);
  }, [router, fetchScoring, fetchPrompts]);

  function logout() { clearToken(); router.push('/login'); }

  async function saveWeights() {
    setSavingWeights(true);
    setWeightMsg('');
    try {
      await settings.updateWeights(editedWeights, changeLog || undefined);
      setWeightMsg('New scoring version saved and activated.');
      setChangeLog('');
      await fetchScoring();
    } catch (err) {
      setWeightMsg(`Error: ${(err as Error).message}`);
    } finally {
      setSavingWeights(false);
    }
  }

  function resetWeights() {
    if (activeConfig?.weights) {
      setEditedWeights({ ...(activeConfig.weights as Record<string, number>) });
    }
  }

  function openEditPrompt(prompt: PromptTemplate) {
    setEditingPrompt(prompt);
    setEditedTemplate(prompt.template);
    setEditedNotes(prompt.notes ?? '');
    setPromptMsg('');
  }

  async function savePrompt() {
    if (!editingPrompt) return;
    setSavingPrompt(true);
    setPromptMsg('');
    try {
      await settings.updatePrompt(
        editingPrompt._id,
        editedTemplate,
        editedNotes || undefined,
      );
      setPromptMsg('Prompt updated — new version saved and activated.');
      setEditingPrompt(null);
      await fetchPrompts();
    } catch (err) {
      setPromptMsg(`Error: ${(err as Error).message}`);
    } finally {
      setSavingPrompt(false);
    }
  }

  if (!isMounted) return null;

  const weightTotal = Object.values(editedWeights).reduce((s, v) => s + v, 0);

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

        <div className="sidebar-section">
          <div className="sidebar-label">Config Section</div>
          <button
            className={`nav-item${tab === 'scoring' ? ' active' : ''}`}
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none' }}
            onClick={() => setTab('scoring')}
          >
            <span style={{ color: 'var(--fg-muted)', marginRight: 4 }}>&rsaquo;</span>
            Scoring Weights
          </button>
          <button
            className={`nav-item${tab === 'prompts' ? ' active' : ''}`}
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none' }}
            onClick={() => setTab('prompts')}
          >
            <span style={{ color: 'var(--fg-muted)', marginRight: 4 }}>&rsaquo;</span>
            Prompt Templates
          </button>
        </div>

        {/* Version history */}
        {tab === 'scoring' && allConfigs.length > 0 && (
          <div className="sidebar-section">
            <div className="sidebar-label">Version History</div>
            {allConfigs.slice(0, 8).map(cfg => (
              <div key={cfg._id} style={{ padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: cfg.active ? 'var(--primary)' : 'var(--fg-muted)' }}>
                    v{cfg.version} {cfg.active && '✓'}
                  </span>
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--fg-muted)', fontSize: 9 }}>
                    {new Date(cfg.createdAt).toISOString().slice(0, 10)}
                  </span>
                </div>
                {cfg.changeLog && (
                  <div style={{ fontSize: 9, color: 'var(--fg-muted)', marginTop: 2, textTransform: 'uppercase' }}>{cfg.changeLog}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* Main */}
      <main className="main-content">
        <div className="page-header">
          <div>
            <h1 className="page-title">Settings</h1>
            <div className="page-subtitle">
              {tab === 'scoring'
                ? `Scoring engine · Active: v${activeConfig?.version ?? '—'}`
                : `Prompt templates · ${promptList.length} loaded`
              }
            </div>
          </div>
        </div>

        {/* ── SCORING TAB ── */}
        {tab === 'scoring' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16 }}>
            {/* Weight editor */}
            <div className="panel">
              <div className="panel-header">
                <span className="panel-title">Scoring Weights</span>
                <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: weightTotal !== 100 ? 'var(--danger)' : 'var(--success)' }}>
                  TOTAL: {weightTotal}
                  {weightTotal !== 100 && ' ≠ 100'}
                </span>
              </div>

              <div style={{ padding: '8px 0' }}>
                {WEIGHT_FACTORS.map(factor => (
                  <div key={factor} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', gap: 12, alignItems: 'center', padding: '6px 4px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-dim)' }}>
                      {factor}
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={30}
                      step={1}
                      value={editedWeights[factor] ?? 0}
                      onChange={e => setEditedWeights(prev => ({ ...prev, [factor]: Number(e.target.value) }))}
                      style={{ accentColor: 'var(--primary)', width: '100%' }}
                    />
                    <input
                      type="number"
                      className="input"
                      min={0}
                      max={100}
                      value={editedWeights[factor] ?? 0}
                      onChange={e => setEditedWeights(prev => ({ ...prev, [factor]: Number(e.target.value) }))}
                      style={{ padding: '2px 4px', textAlign: 'center', fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>
                  Change Log (optional)
                </div>
                <input
                  className="input"
                  style={{ marginBottom: 12 }}
                  placeholder="e.g. Increased booking system weight after Q1 analysis"
                  value={changeLog}
                  onChange={e => setChangeLog(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    disabled={savingWeights}
                    onClick={saveWeights}
                  >
                    {savingWeights ? 'SAVING...' : '> SAVE NEW VERSION'}
                  </button>
                  <button className="btn btn-ghost" onClick={resetWeights}>RESET</button>
                </div>
                {weightMsg && (
                  <div style={{
                    marginTop: 8, fontSize: 10, textTransform: 'uppercase',
                    color: weightMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)',
                  }}>
                    {weightMsg}
                  </div>
                )}
              </div>
            </div>

            {/* Active config info */}
            <div>
              {activeConfig && (
                <div className="panel" style={{ marginBottom: 16 }}>
                  <div className="panel-header"><span className="panel-title">Active Config</span></div>
                  <div style={{ padding: '8px 4px' }}>
                    {[
                      ['Version', `v${activeConfig.version}`],
                      ['Active', activeConfig.active ? 'YES' : 'NO'],
                      ['Created', new Date(activeConfig.createdAt).toISOString().slice(0, 10)],
                      ...(activeConfig.changeLog ? [['Notes', activeConfig.changeLog]] : []),
                    ].map(([label, value]) => (
                      <div key={String(label)} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)' }}>{label}</span>
                        <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--fg-dim)' }}>{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="panel">
                <div className="panel-header"><span className="panel-title">Industry Multipliers</span></div>
                <div style={{ padding: '8px 4px' }}>
                  {[
                    ['Tier 1 (High-value)', '×1.3'],
                    ['Tier 2 (Standard)', '×1.0'],
                    ['Tier 3 (Low-value)', '×0.5'],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>{label}</span>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", color: 'var(--warm)' }}>{value}</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 8, fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Multipliers apply to final score before thresholds. Hot ≥ 80, Warm ≥ 55.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── PROMPTS TAB ── */}
        {tab === 'prompts' && (
          <div style={{ display: 'grid', gridTemplateColumns: editingPrompt ? '1fr 480px' : '1fr', gap: 16 }}>
            {/* Prompt list */}
            <div className="panel" style={{ padding: 0 }}>
              <div className="panel-header" style={{ padding: '10px 16px' }}>
                <span className="panel-title">Prompt Templates</span>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: 160 }}>Type</th>
                    <th style={{ width: 80 }}>Version</th>
                    <th style={{ width: 80 }}>Status</th>
                    <th style={{ width: 80 }}>Reply Rate</th>
                    <th style={{ width: 100 }}>Industry</th>
                    <th style={{ width: 120 }}>Updated</th>
                    <th style={{ width: 80 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {promptList.map(prompt => (
                    <tr
                      key={prompt._id}
                      style={{ cursor: 'crosshair', background: editingPrompt?._id === prompt._id ? 'rgba(255,77,0,0.06)' : undefined }}
                      onClick={() => openEditPrompt(prompt)}
                    >
                      <td style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, textTransform: 'uppercase' }}>{prompt.type}</td>
                      <td style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11 }}>v{prompt.version}</td>
                      <td>
                        <span style={{
                          fontSize: 9, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.06em',
                          border: `1px solid ${prompt.active ? 'var(--success)' : 'var(--border)'}`,
                          color: prompt.active ? 'var(--success)' : 'var(--fg-muted)',
                        }}>
                          {prompt.active ? 'ACTIVE' : 'RETIRED'}
                        </span>
                      </td>
                      <td style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: (prompt.replyRate ?? 0) < 5 ? 'var(--danger)' : 'var(--success)' }}>
                        {prompt.replyRate != null ? `${prompt.replyRate.toFixed(1)}%` : '—'}
                      </td>
                      <td style={{ fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase' }}>{prompt.industry ?? 'all'}</td>
                      <td style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, color: 'var(--fg-muted)' }}>
                        {new Date(prompt.createdAt).toISOString().slice(0, 10)}
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 9 }} onClick={() => openEditPrompt(prompt)}>
                          EDIT
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {promptList.length === 0 && (
                <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: "'Share Tech Mono', monospace", fontSize: 13, color: 'var(--fg-muted)' }}>
                  [ NO PROMPTS — RUN SEED ]
                </div>
              )}
            </div>

            {/* Prompt editor */}
            {editingPrompt && (
              <div className="panel">
                <div className="panel-header">
                  <span className="panel-title">Edit: {editingPrompt.type.toUpperCase()} v{editingPrompt.version}</span>
                  <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 9 }} onClick={() => setEditingPrompt(null)}>✕</button>
                </div>

                <div style={{ padding: '8px 0' }}>
                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>
                    Template Body
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--cold)', marginBottom: 6, fontFamily: "'Share Tech Mono', monospace" }}>
                    Use {'{placeholders}'} — e.g. {'{businessName}'}, {'{detectedPains}'}, {'{pitchAngle}'}
                  </div>
                  <textarea
                    className="input"
                    style={{
                      width: '100%', minHeight: 280, resize: 'vertical',
                      fontFamily: "'Share Tech Mono', monospace", fontSize: 11, lineHeight: 1.6,
                    }}
                    value={editedTemplate}
                    onChange={e => setEditedTemplate(e.target.value)}
                  />

                  <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6, marginTop: 12 }}>
                    Internal Notes
                  </div>
                  <input
                    className="input"
                    placeholder="e.g. Optimized for SaaS dental practices"
                    value={editedNotes}
                    onChange={e => setEditedNotes(e.target.value)}
                  />

                  {/* Stats */}
                  <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
                    <div style={{ flex: 1, padding: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Reply Rate</div>
                      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 16, color: (editingPrompt.replyRate ?? 0) < 5 ? 'var(--danger)' : 'var(--success)' }}>
                        {editingPrompt.replyRate != null ? `${editingPrompt.replyRate.toFixed(1)}%` : '—'}
                      </div>
                    </div>
                    <div style={{ flex: 1, padding: '8px', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 9, color: 'var(--fg-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Samples</div>
                      <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 16, color: 'var(--fg-dim)' }}>
                        {editingPrompt.sampleCount ?? '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} disabled={savingPrompt} onClick={savePrompt}>
                      {savingPrompt ? 'SAVING...' : '> SAVE NEW VERSION'}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setEditingPrompt(null)}>CANCEL</button>
                  </div>

                  {promptMsg && (
                    <div style={{
                      marginTop: 8, fontSize: 10, textTransform: 'uppercase',
                      color: promptMsg.startsWith('Error') ? 'var(--danger)' : 'var(--success)',
                    }}>
                      {promptMsg}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
