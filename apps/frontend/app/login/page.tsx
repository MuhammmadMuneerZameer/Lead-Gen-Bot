"use client";

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { auth, setToken, setRefreshToken, setUser } from '../lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await auth.login(email, password);
      setToken(result.accessToken);
      setRefreshToken(result.refreshToken);
      setUser(result.user);
      router.push('/');
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ width: 360 }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontFamily: "'Space Grotesk', sans-serif",
            fontWeight: 800,
            fontSize: 28,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--primary)',
          }}>
            HYDRAFOX
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: 4 }}>
            Lead Intelligence Engine v3.0
          </div>
        </div>

        {/* Form */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Operator Access</span>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>
                Email
              </div>
              <input
                type="email"
                className="input"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="operator@agency.com"
                required
                autoComplete="email"
              />
            </div>

            <div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--fg-muted)', marginBottom: 6 }}>
                Password
              </div>
              <input
                type="password"
                className="input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                fontSize: 11,
                color: 'var(--danger)',
                border: '1px solid var(--danger)',
                padding: '8px 12px',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4, padding: '10px 0' }}
              disabled={loading}
            >
              {loading ? 'AUTHENTICATING...' : '> AUTHENTICATE'}
            </button>
          </form>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 10, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Contact your administrator for access credentials
        </div>
      </div>
    </div>
  );
}
