import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Routes that don't require authentication
const publicRoutes = ['/login', '/register', '/forgot-password']

// Routes that should redirect to home if already authenticated
const authRoutes = ['/login', '/register', '/forgot-password']

// Security headers applied to all responses
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';",
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(securityHeaders)) {
    response.headers.set(key, value)
  }
  return response
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Check for session cookie
  const sessionCookie = request.cookies.get('wallit_session')
  const isAuthenticated = !!sessionCookie?.value
  
  // If accessing auth routes while authenticated, redirect to home
  if (isAuthenticated && authRoutes.some(route => pathname.startsWith(route))) {
    return applySecurityHeaders(NextResponse.redirect(new URL('/', request.url)))
  }
  
  // If accessing protected routes while not authenticated, redirect to login
  if (!isAuthenticated && !publicRoutes.some(route => pathname.startsWith(route))) {
    return applySecurityHeaders(NextResponse.redirect(new URL('/login', request.url)))
  }
  
  return applySecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\..*|public).*)',
  ],
}
