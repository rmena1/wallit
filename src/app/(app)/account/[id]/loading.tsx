function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[540px] items-center gap-3">
          <PulseBlock className="h-9 w-9 rounded-lg" />
          <div className="space-y-2">
            <PulseBlock className="h-4 w-28" />
            <PulseBlock className="h-3 w-24" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-4 px-4 pb-28 pt-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <PulseBlock className="mb-3 h-4 w-36" />
          <div className="grid grid-cols-2 gap-2">
            <PulseBlock className="h-20 w-full" />
            <PulseBlock className="h-20 w-full" />
          </div>
          <PulseBlock className="mt-2 h-16 w-full" />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <PulseBlock className="mb-3 h-3 w-28" />
          <PulseBlock className="h-10 w-44" />
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
          <PulseBlock className="mb-3 h-4 w-36" />
          <PulseBlock className="h-52 w-full" />
        </div>

        <div>
          <PulseBlock className="mb-3 h-4 w-32" />
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
