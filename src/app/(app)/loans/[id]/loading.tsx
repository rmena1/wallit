function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[540px] items-center justify-between">
          <PulseBlock className="h-6 w-16" />
          <PulseBlock className="h-5 w-24" />
          <div className="w-[60px]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-4 px-4 pb-28 pt-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <PulseBlock className="mb-2 h-5 w-44" />
          <PulseBlock className="mb-5 h-3 w-36" />

          <div className="mb-4 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <PulseBlock className="h-3 w-16" />
                <PulseBlock className="h-6 w-full" />
              </div>
            ))}
          </div>

          <PulseBlock className="mb-2 h-2 w-full rounded-full" />
          <PulseBlock className="mb-5 ml-auto h-3 w-20" />
          <PulseBlock className="h-12 w-full" />
        </div>

        <div>
          <PulseBlock className="mb-3 h-4 w-36" />
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 p-3">
                <div className="space-y-2">
                  <PulseBlock className="h-3 w-44" />
                  <PulseBlock className="h-3 w-24" />
                </div>
                <PulseBlock className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
