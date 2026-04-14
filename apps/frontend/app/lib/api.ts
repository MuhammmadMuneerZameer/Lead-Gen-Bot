/**
 * API client — all fetch calls to the HydraFox backend.
 * Reads the token from localStorage, attaches it as Bearer.
 * On 401 → clears token and redirects to /login.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('hf_token');
}

export function setToken(token: string): void {
  localStorage.setItem('hf_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('hf_token');
  localStorage.removeItem('hf_user');
}

export function getUser(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('hf_user');
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

export function setUser(user: Record<string, unknown>): void {
  localStorage.setItem('hf_user', JSON.stringify(user));
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== 'undefined') window.location.href = '/login';
    throw new ApiError('Unauthorized', 401);
  }

  const data: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = (data as { message?: string; error?: string })?.message
      ?? (data as { error?: string })?.error
      ?? `HTTP ${res.status}`;
    throw new ApiError(msg, res.status);
  }

  return data as T;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: (email: string, password: string) =>
    request<{ accessToken: string; refreshToken: string; user: Record<string, unknown> }>(
      '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) },
    ),
  me: () => request<Record<string, unknown>>('/api/auth/me'),
};

// ── Analytics ────────────────────────────────────────────────────────────────

export interface DashboardData {
  kpis: {
    leadsToday: number;
    hotQueue: number;
    warmQueue: number;
    coldQueue: number;
    enrichedToday: number;
    contactedLast7d: number;
    wonLast30d: number;
    totalLeads: number;
    aiCostToday: number;
  };
  queues: {
    scraping: Record<string, number>;
    enrichment: Record<string, number>;
    scoring: Record<string, number>;
  };
  scoreDistribution: Array<{ _id: string | number; count: number }>;
}

export const analytics = {
  dashboard: () => request<DashboardData>('/api/analytics/dashboard'),
  pipeline: (days = 30) => request<{ days: number; data: unknown[] }>(`/api/analytics/pipeline?days=${days}`),
  costs: (days = 14) => request<unknown>(`/api/analytics/costs?days=${days}`),
  outcomes: (days = 30) => request<unknown>(`/api/analytics/outcomes?days=${days}`),
  industries: () => request<{ data: unknown[] }>('/api/analytics/industries'),
  selfImprove: () => request<{ data: unknown[] }>('/api/analytics/self-improve'),
};

// ── Leads ────────────────────────────────────────────────────────────────────

export interface Lead {
  _id: string;
  businessName: string;
  domain: string;
  website?: string;
  phone?: string;
  email?: string;
  socialLinks: string[];
  websiteQuality: 'outdated' | 'basic' | 'modern' | 'unknown';
  industry?: string;
  industryTier: 1 | 2 | 3;
  opportunityScore: number;
  opportunityLevel: 'high' | 'medium' | 'low';
  scoreBreakdown: Record<string, number>;
  status: string;
  source: string;
  tags: string[];
  createdAt: string;
  enrichedAt?: string;
}

export interface LeadListResponse {
  data: Lead[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export interface LeadFilters {
  page?: number;
  limit?: number;
  opportunityLevel?: string;
  status?: string;
  industry?: string;
  search?: string;
  sortBy?: string;
  sortDir?: string;
}

export interface ScoringConfig {
  version: number;
  weights: Record<string, number>;
  notes?: string;
}

export const leads = {
  list: (filters: LeadFilters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v != null && params.set(k, String(v)));
    return request<LeadListResponse>(`/api/leads?${params}`);
  },
  get: (id: string) => request<{ lead: Lead; enrichment: unknown }>(`/api/leads/${id}`),
  create: (data: { businessName: string; domain: string; website?: string; industry?: string }) =>
    request<{ lead: Lead; isNew: boolean }>('/api/leads', { method: 'POST', body: JSON.stringify(data) }),
  updateStatus: (id: string, status: string) =>
    request<{ lead: Lead }>(`/api/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  logOutcome: (
    id: string,
    data: { actualOutcome: string; replyQuality?: string; channelUsed: string; dealValue?: number },
  ) =>
    request<unknown>(`/api/leads/${id}/outcome`, { method: 'POST', body: JSON.stringify(data) }),
  rescore: (id: string) =>
    request<{ score: number; priority: string }>(`/api/leads/${id}/rescore`, { method: 'POST' }),
};

// ── Jobs ─────────────────────────────────────────────────────────────────────

export interface QueueStats {
  stats: {
    scraping: Record<string, number>;
    enrichment: Record<string, number>;
    scoring: Record<string, number>;
  };
  paused: Record<string, boolean>;
}

export const jobs = {
  stats: () => request<QueueStats>('/api/jobs'),
  pause: (queue: string) => request<unknown>(`/api/jobs/${queue}/pause`, { method: 'POST' }),
  resume: (queue: string) => request<unknown>(`/api/jobs/${queue}/resume`, { method: 'POST' }),
  enqueueScrape: (query: string, sources: string[] = ['gmaps'], location?: string, autoExpand = false) =>
    request<{ jobId: string; sources: string[] }>('/api/jobs/scrape', {
      method: 'POST',
      body: JSON.stringify({ query, sources, location, autoExpand }),
    }),
};

// ── Settings ─────────────────────────────────────────────────────────────────

export const settings = {
  activeScoringConfig: () => request<Record<string, unknown>>('/api/settings/scoring/active'),
  allScoringConfigs: () => request<{ data: unknown[] }>('/api/settings/scoring'),
  updateWeights: (weights: Record<string, number>, reason?: string) =>
    request<unknown>('/api/settings/scoring', { method: 'POST', body: JSON.stringify({ weights, reason }) }),
  prompts: (type?: string) =>
    request<{ data: unknown[] }>(`/api/settings/prompts${type ? `?type=${type}` : ''}`),
};
