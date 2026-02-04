'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500))
    
    setSubmitted(true)
    setLoading(false)
  }

  const inputStyle: React.CSSProperties = {
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

  if (submitted) {
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
          <div style={{ textAlign: 'center' }}>
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
              <span style={{ fontSize: '24px' }}>📧</span>
            </div>
            <h1
              style={{
                fontSize: '28px',
                fontWeight: 700,
                color: '#1a1a1a',
                letterSpacing: '-0.03em',
                lineHeight: 1.2,
                margin: '0 0 12px 0',
              }}
            >
              Check your email
            </h1>
            <p
              style={{
                fontSize: '15px',
                color: '#8e8e93',
                lineHeight: 1.5,
                marginBottom: '32px',
              }}
            >
              We've sent password reset instructions to{' '}
              <span style={{ color: '#22c55e', fontWeight: 500 }}>{email}</span>
            </p>
            
            <Link
              href="/login"
              style={{
                display: 'flex',
                width: '100%',
                height: '52px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: 'white',
                fontSize: '16px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                textDecoration: 'none',
                boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3), 0 1px 3px rgba(0, 0, 0, 0.1)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              Back to sign in
            </Link>
            
            <p
              style={{
                fontSize: '14px',
                color: '#8e8e93',
                marginTop: '24px',
                lineHeight: 1.5,
              }}
            >
              Didn't receive an email? Check your spam folder or{' '}
              <button
                onClick={() => setSubmitted(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#22c55e',
                  fontWeight: 600,
                  fontSize: '14px',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                try again
              </button>
            </p>
          </div>
        </div>
      </div>
    )
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
            <span style={{ fontSize: '24px' }}>🔑</span>
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
            Reset your password
          </h1>
          <p
            style={{
              fontSize: '15px',
              color: '#8e8e93',
              marginTop: '8px',
              lineHeight: 1.5,
            }}
          >
            Enter your email and we'll send you reset instructions
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '28px' }}>
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
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
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
              marginBottom: '24px',
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
            {loading ? 'Sending...' : 'Send reset instructions'}
          </button>
        </form>

        <p
          style={{
            textAlign: 'center',
            fontSize: '14px',
            color: '#8e8e93',
            lineHeight: 1.5,
          }}
        >
          Remember your password?{' '}
          <Link href="/login" style={{ color: '#22c55e', fontWeight: 600, textDecoration: 'none' }}>
            Back to sign in
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