import { pb } from '../../lib/pocketbase';

/**
 * PocketBase Facade — Mimics the old HydraFox Express API
 * to maintain frontend compatibility during migration.
 */

export function getToken(): string | null {
  return pb.authStore.token;
}

export function setToken(token: string): void {
  // Not needed — PB handles this via authStore
}

export function clearToken(): void {
  pb.authStore.clear();
}

export function getUser(): Record<string, unknown> | null {
  return pb.authStore.model as Record<string, unknown> | null;
}

export function setUser(user: Record<string, unknown> | null): void {
  // PB handles this automatically on authWithPassword, 
  // but we add this for legacy support in login components
  if (user) {
    pb.authStore.save(pb.authStore.token, user as any);
  } else {
    pb.authStore.clear();
  }
}

// ── Transformers ─────────────────────────────────────────────────────────────

/**
 * Maps PocketBase record to the old "Lead" interface
 */
function toLead(record: any): Lead {
  return {
    _id: record.id,
    businessName: record.business_name,
    domain: record.domain,
    website: record.website,
    phone: record.phone,
    email: record.email,
    socialLinks: record.social_links || [],
    websiteQuality: record.website_quality || 'unknown',
    industry: record.industry,
    industryTier: record.industry_tier || 2,
    opportunityScore: record.score || 0,
    opportunityLevel: record.opportunity_level || 'low',
    scoreBreakdown: record.score_breakdown || {},
    status: record.status || 'new',
    source: record.source || 'unknown',
    tags: record.tags || [],
    createdAt: record.created,
  };
}

// ── Types ────────────────────────────────────────────────────────────────────

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

export interface LeadListResponse {
  data: Lead[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export const auth = {
  login: async (email: string, password: string) => {
    const authData = await pb.collection('users').authWithPassword(email, password);
    return {
      accessToken: pb.authStore.token,
      refreshToken: '', // PB doesn't use refresh tokens like JWT
      user: authData.record as unknown as Record<string, unknown>,
    };
  },
  me: async () => {
    return pb.authStore.model as unknown as Record<string, unknown>;
  },
};

// ── Leads ────────────────────────────────────────────────────────────────────

export const leads = {
  list: async (filters: LeadFilters = {}) => {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    
    // Sort logic mapping
    let sort = '-created';
    if (filters.sortBy) {
      const fieldMapping: Record<string, string> = {
        opportunityScore: 'score',
        createdAt: 'created',
        businessName: 'business_name'
      };
      const field = fieldMapping[filters.sortBy] || filters.sortBy;
      sort = filters.sortDir === 'asc' ? field : `-${field}`;
    }

    // Filter logic mapping
    const pbFilters: string[] = [];
    if (filters.opportunityLevel) pbFilters.push(`opportunity_level = "${filters.opportunityLevel}"`);
    if (filters.status) pbFilters.push(`status = "${filters.status}"`);
    if (filters.search) pbFilters.push(`(business_name ~ "${filters.search}" || domain ~ "${filters.search}")`);

    const result = await pb.collection('leads').getList(page, limit, {
      sort,
      filter: pbFilters.join(' && ')
    });

    return {
      data: result.items.map(toLead),
      pagination: {
        page: result.page,
        limit: result.perPage,
        total: result.totalItems,
        pages: result.totalPages
      }
    };
  },

  get: async (id: string) => {
    const lead = await pb.collection('leads').getOne(id);
    return {
      lead: toLead(lead),
      enrichment: lead.score_breakdown || {} // PocketBase doesn't separate these like Mongo anymore
    };
  },

  create: async (data: { businessName: string; domain: string; website?: string; industry?: string }) => {
    const record = await pb.collection('leads').create({
      business_name: data.businessName,
      domain: data.domain,
      website: data.website,
      industry: data.industry,
      status: 'new'
    });
    return { lead: toLead(record), isNew: true };
  },

  updateStatus: async (id: string, status: string) => {
    const record = await pb.collection('leads').update(id, { status });
    return { lead: toLead(record) };
  },

  logOutcome: async (id: string, data: any) => {
    // Optionally create an outcome record in a new collection or update lead
    return await pb.collection('leads').update(id, { 
      logs: { ...(data || {}), timestamp: new Date() } 
    });
  },

  rescore: async (id: string) => {
    // This now triggers a job in PB
    const job = await pb.collection('jobs').create({
      type: 'scoring',
      status: 'pending',
      payload: { leadId: id }
    });
    return { jobId: job.id };
  }
};

// ── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = {
  enqueueScrape: async (query: string, sources: string[] = ['gmaps'], location?: string, autoExpand = false) => {
    const job = await pb.collection('jobs').create({
      type: 'scraper',
      status: 'pending',
      payload: { query, sources, location, autoExpand }
    });
    return { jobId: job.id };
  },
  
  // Stats and other legacy calls can return empty or mock data if not implemented yet
  stats: async () => ({ stats: { scraping: {}, enrichment: {}, scoring: {} }, paused: {} })
};

// ── Subscriptions ────────────────────────────────────────────────────────────

export const subscribeLeads = (callback: (data: Lead) => void) => {
  pb.collection('leads').subscribe('*', (e) => {
    if (e.action === 'create' || e.action === 'update') {
      callback(toLead(e.record));
    }
  });
  return () => pb.collection('leads').unsubscribe('*');
};
