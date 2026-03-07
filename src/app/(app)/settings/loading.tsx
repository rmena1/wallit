function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto w-full max-w-[540px] text-center">
          <PulseBlock className="mx-auto h-5 w-36" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-5 px-4 pb-28 pt-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <PulseBlock className="mb-4 h-5 w-40" />
          <PulseBlock className="mb-4 h-11 w-full" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                <div className="space-y-2">
                  <PulseBlock className="h-3 w-32" />
                  <PulseBlock className="h-3 w-24" />
                </div>
                <div className="flex gap-2">
                  <PulseBlock className="h-7 w-7 rounded-lg" />
                  <PulseBlock className="h-7 w-7 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <PulseBlock className="mb-4 h-5 w-32" />
          <div className="mb-4 flex gap-2">
            <PulseBlock className="h-11 w-12" />
            <PulseBlock className="h-11 flex-1" />
            <PulseBlock className="h-11 w-11" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                <div className="flex items-center gap-3">
                  <PulseBlock className="h-7 w-7" />
                  <PulseBlock className="h-3 w-32" />
                </div>
                <div className="flex gap-2">
                  <PulseBlock className="h-7 w-7 rounded-lg" />
                  <PulseBlock className="h-7 w-7 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
