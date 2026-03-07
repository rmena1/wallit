function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto w-full max-w-[540px] text-center">
          <PulseBlock className="mx-auto h-5 w-28" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-4 px-4 pb-28 pt-4">
        <PulseBlock className="h-11 w-full" />

        <div className="flex gap-2">
          <PulseBlock className="h-10 flex-1" />
          <PulseBlock className="h-10 flex-1" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PulseBlock className="h-16 w-full" />
          <PulseBlock className="h-16 w-full" />
          <PulseBlock className="h-16 w-full" />
        </div>

        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <PulseBlock className="mb-4 h-4 w-28" />
            <PulseBlock className="h-52 w-full" />
          </div>
        ))}

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <PulseBlock className="mb-4 h-4 w-40" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i}>
                <div className="mb-2 flex items-center justify-between">
                  <PulseBlock className="h-3 w-28" />
                  <PulseBlock className="h-3 w-20" />
                </div>
                <PulseBlock className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
