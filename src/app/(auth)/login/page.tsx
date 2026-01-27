'use client'

import { useState } from 'react'
import Link from 'next/link'
import { login } from '@/lib/actions/auth'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const formData = new FormData(e.currentTarget)
      const result = await login(formData)
      if (!result.success) {
        setError(result.error || 'An error occurred')
      }
    } catch {
      // Redirect happens on success
    } finally {
      setLoading(false)
    }
  }

  const inputBase: React.CSSProperties = {
    width: '100%',
    height: '52px',
    borderRadius: '12px',
    border: '1px solid rgba(0, 0, 0, 0.08)',
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    fontSize: '16px',
    color: '#1a1a1a',
    outline: 'none',
    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    boxSizing: 'border-box' as const,
    padding: '0 18px',
  }

  const inputFocused: React.CSSProperties = {
    ...inputBase,
    border: '1px solid #22c55e',
    backgroundColor: '#ffffff',
    boxShadow: '0 0 0 4px rgba(34, 197, 94, 0.1)',
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: '420px',
        margin: '0 auto',
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          borderRadius: '24px',
          boxShadow:
            '0 0 0 1px rgba(0, 0, 0, 0.03), 0 2px 4px rgba(0, 0, 0, 0.02), 0 12px 40px rgba(0, 0, 0, 0.06)',
          padding: '48px 40px',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
            }}
          >
            <span style={{ fontSize: '24px' }}>💰</span>
          </div>
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 700,
              color: '#1a1a1a',
              letterSpacing: '-0.03em',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            Welcome back
          </h1>
          <p
            style={{
              fontSize: '15px',
              color: '#8e8e93',
              marginTop: '8px',
              lineHeight: 1.5,
            }}
          >
            Sign in to continue to wallit
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '12px',
                padding: '12px 16px',
                marginBottom: '20px',
                fontSize: '14px',
                color: '#dc2626',
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '28px' }}>
            <div>
              <label
                htmlFor="email"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#3a3a3c',
                  marginBottom: '6px',
                  letterSpacing: '0.01em',
                }}
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                onFocus={() => setFocusedField('email')}
                onBlur={() => setFocusedField(null)}
                style={focusedField === 'email' ? inputFocused : inputBase}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#3a3a3c',
                  marginBottom: '6px',
                  letterSpacing: '0.01em',
                }}
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                required
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                style={focusedField === 'password' ? inputFocused : inputBase}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              height: '52px',
              borderRadius: '14px',
              border: 'none',
              background: loading
                ? '#8e8e93'
                : 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: 'white',
              fontSize: '16px',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: loading
                ? 'none'
                : '0 2px 8px rgba(34, 197, 94, 0.3), 0 1px 3px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            {loading && (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                style={{ animation: 'spin 1s linear infinite' }}
              >
                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="white" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p
          style={{
            textAlign: 'center',
            fontSize: '14px',
            color: '#8e8e93',
            marginTop: '28px',
            lineHeight: 1.5,
          }}
        >
          Don&apos;t have an account?{' '}
          <Link href="/register" style={{ color: '#22c55e', fontWeight: 600, textDecoration: 'none' }}>
            Create one
          </Link>
        </p>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
