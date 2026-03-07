function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[540px] items-center justify-between">
          <PulseBlock className="h-6 w-16" />
          <PulseBlock className="h-5 w-28" />
          <div className="w-[60px]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-3 px-4 pb-28 pt-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="space-y-2">
                <PulseBlock className="h-4 w-40" />
                <PulseBlock className="h-3 w-28" />
              </div>
              <div className="space-y-2">
                <PulseBlock className="h-4 w-20" />
                <PulseBlock className="h-3 w-16" />
              </div>
            </div>
            <PulseBlock className="mb-2 h-2 w-full rounded-full" />
            <PulseBlock className="ml-auto h-3 w-24" />
          </div>
        ))}
      </main>
    </div>
  )
}
