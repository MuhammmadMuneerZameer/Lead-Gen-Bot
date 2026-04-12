// Proxy manager — fully implemented in Phase 2
// Manages rotating residential proxies for scraping

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export async function getNextProxy(_city?: string): Promise<ProxyConfig | null> {
  // Phase 2: implement BrightData SDK or custom rotation middleware
  // Phase 1: returns null (direct connection — dev only)
  return null;
}

export async function reportProxyBlocked(_proxy: ProxyConfig): Promise<void> {
  // Phase 2: mark proxy as blocked, trigger problem learner
}

export async function getProxyPoolStatus(): Promise<{ total: number; available: number }> {
  return { total: 0, available: 0 };
}
