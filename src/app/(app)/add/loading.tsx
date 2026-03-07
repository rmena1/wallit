function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-4 py-3">
        <div className="mx-auto flex w-full max-w-[540px] items-center justify-between">
          <PulseBlock className="h-6 w-16" />
          <PulseBlock className="h-5 w-40" />
          <div className="w-[60px]" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-4 px-4 pb-28 pt-5">
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-zinc-800 bg-zinc-900 p-1">
          <PulseBlock className="h-10 w-full" />
          <PulseBlock className="h-10 w-full" />
          <PulseBlock className="h-10 w-full" />
        </div>

        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-5">
          <PulseBlock className="h-12 w-full" />
          <PulseBlock className="h-12 w-full" />
          <div className="grid grid-cols-[2fr,1fr] gap-3">
            <PulseBlock className="h-12 w-full" />
            <PulseBlock className="h-12 w-full" />
          </div>
          <div className="grid grid-cols-[2fr,1fr] gap-3">
            <PulseBlock className="h-12 w-full" />
            <PulseBlock className="h-12 w-full" />
          </div>
          <div className="flex gap-2">
            <PulseBlock className="h-12 flex-1" />
            <PulseBlock className="h-12 w-12" />
          </div>
        </div>

        <PulseBlock className="h-12 w-full" />
      </main>
    </div>
  )
}
