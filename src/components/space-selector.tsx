'use client'

import { useTransition, useState } from 'react'
import { switchSpace } from '@/lib/actions/spaces'
import type { AvailableSpace } from '@/lib/spaces'

export function SpaceSelector({ spaces, currentSpaceId }: { spaces: AvailableSpace[]; currentSpaceId: string }) {
  const [pending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const current = spaces.find((space) => space.id === currentSpaceId) ?? spaces[0]

  async function choose(spaceId: string) {
    setOpen(false)
    if (spaceId === currentSpaceId || pending) return

    startTransition(async () => {
      const result = await switchSpace(spaceId)
      if (!result.success) return

      // Keep the visible selector tied to server-rendered data. A hard same-page
      // navigation avoids the misleading state where the selector says the new
      // Space while the rest of the page still shows the previous Space's data.
      window.location.assign(window.location.pathname + window.location.search)
    })
  }

  if (!current) return null

  return (
    <div
      aria-label="Selector de Space"
      style={{
        position: 'fixed',
        top: 58,
        right: 12,
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 6,
      }}
    >
      <button
        type="button"
        aria-label={`Space activo: ${current.emoji} ${current.name}`}
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '7px 10px',
          borderRadius: 999,
          border: '1px solid #2a2a2a',
          backgroundColor: 'rgba(17,17,17,0.92)',
          color: '#f5f5f5',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(10px)',
          fontSize: 13,
          fontWeight: 700,
          cursor: pending ? 'wait' : 'pointer',
          maxWidth: 190,
          opacity: pending ? 0.82 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.emoji} {current.name}</span>
        <span aria-hidden="true" style={{ color: '#a1a1aa' }}>▾</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Spaces disponibles"
          style={{
            minWidth: 180,
            padding: 6,
            borderRadius: 14,
            border: '1px solid #2a2a2a',
            backgroundColor: '#111',
            boxShadow: '0 16px 36px rgba(0,0,0,0.45)',
          }}
        >
          {spaces.map((space) => (
            <button
              key={space.id}
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => choose(space.id)}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '9px 10px',
                border: 'none',
                borderRadius: 10,
                backgroundColor: space.id === currentSpaceId ? '#1e293b' : 'transparent',
                color: '#f5f5f5',
                cursor: pending ? 'wait' : 'pointer',
                textAlign: 'left',
                fontSize: 13,
              }}
            >
              <span>{space.emoji} {space.name}</span>
              {space.id === currentSpaceId && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
