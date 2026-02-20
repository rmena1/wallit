function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[540px] items-center justify-between">
          <div className="flex items-center gap-3">
            <PulseBlock className="h-8 w-8 rounded-lg" />
            <PulseBlock className="h-4 w-20" />
            <PulseBlock className="h-5 w-16 rounded-full" />
          </div>
          <PulseBlock className="h-9 w-9 rounded-full" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-4 px-4 pb-28 pt-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <PulseBlock className="mb-3 h-3 w-28" />
          <PulseBlock className="mb-5 h-10 w-48" />
          <div className="grid grid-cols-2 gap-4 border-t border-zinc-800 pt-4">
            <div>
              <PulseBlock className="mb-2 h-3 w-16" />
              <PulseBlock className="h-5 w-24" />
            </div>
            <div>
              <PulseBlock className="mb-2 h-3 w-16" />
              <PulseBlock className="h-5 w-24" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <PulseBlock className="mb-3 h-3 w-24" />
          <PulseBlock className="mb-3 h-8 w-40" />
          <div className="flex flex-wrap gap-2">
            <PulseBlock className="h-3 w-24" />
            <PulseBlock className="h-3 w-24" />
            <PulseBlock className="h-3 w-24" />
          </div>
        </div>

        <div>
          <PulseBlock className="mb-3 h-4 w-20" />
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="min-w-[155px] rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                <PulseBlock className="mb-3 h-3 w-20" />
                <PulseBlock className="mb-2 h-6 w-24" />
                <PulseBlock className="h-3 w-28" />
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <PulseBlock className="h-4 w-36" />
            <PulseBlock className="h-7 w-24 rounded-lg" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                <div className="flex items-center gap-3">
                  <PulseBlock className="h-9 w-9 rounded-lg" />
                  <div className="space-y-2">
                    <PulseBlock className="h-3 w-36" />
                    <PulseBlock className="h-3 w-24" />
                  </div>
                </div>
                <PulseBlock className="h-4 w-20" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
