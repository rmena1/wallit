import type { CSSProperties } from 'react'

export const loadingTheme = {
  background: '#0a0a0a',
  card: '#1a1a1a',
  border: '#2a2a2a',
  skeleton: '#2a2a2a',
  header: '#111111',
  headerBorder: '#1e1e1e',
}

export const pageHeaderStyle: CSSProperties = {
  backgroundColor: loadingTheme.header,
  borderBottom: `1px solid ${loadingTheme.headerBorder}`,
  padding: '12px 16px',
  position: 'sticky',
  top: 0,
  zIndex: 10,
}

export const pageHeaderInnerStyle: CSSProperties = {
  maxWidth: 540,
  margin: '0 auto',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
}

export const pageMainStyle: CSSProperties = {
  maxWidth: 540,
  margin: '0 auto',
  padding: '16px 16px 96px',
}

export const skeletonBaseStyle: CSSProperties = {
  backgroundColor: loadingTheme.skeleton,
  animation: 'wallitSkeletonPulse 1.4s ease-in-out infinite',
}

interface SkeletonBlockProps {
  width?: CSSProperties['width']
  height: CSSProperties['height']
  radius?: number
  style?: CSSProperties
}

export function SkeletonAnimation() {
  return (
    <style>{`@keyframes wallitSkeletonPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }`}</style>
  )
}

export function SkeletonBlock({ width = '100%', height, radius = 10, style }: SkeletonBlockProps) {
  return (
    <div
      style={{
        ...skeletonBaseStyle,
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  )
}

export function SkeletonCard({ style }: { style?: CSSProperties }) {
  return (
    <div
      style={{
        backgroundColor: loadingTheme.card,
        border: `1px solid ${loadingTheme.border}`,
        borderRadius: 16,
        ...style,
      }}
    />
  )
}
