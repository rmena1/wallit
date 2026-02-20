function PulseBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-800 ${className}`} />
}

export default function Loading() {
  return (
    <div className="min-h-screen bg-zinc-950">
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <div className="mx-auto flex w-full max-w-[540px] items-center justify-between">
          <PulseBlock className="h-5 w-5 rounded-md" />
          <PulseBlock className="h-4 w-20" />
          <div className="w-5" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[540px] space-y-3 px-3 pb-24 pt-3">
        <div className="flex items-center gap-2">
          <PulseBlock className="h-3 w-12" />
          <PulseBlock className="h-1.5 flex-1 rounded-full" />
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="mb-4 text-center">
            <PulseBlock className="mx-auto mb-2 h-8 w-36" />
            <PulseBlock className="mx-auto h-3 w-44" />
          </div>

          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
              <PulseBlock className="h-8 w-full" />
              <PulseBlock className="h-8 w-full" />
              <PulseBlock className="h-8 w-full" />
            </div>
            <PulseBlock className="h-9 w-full" />
            <div className="grid grid-cols-[1fr,80px] gap-2">
              <PulseBlock className="h-9 w-full" />
              <PulseBlock className="h-9 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <PulseBlock className="h-9 w-full" />
              <PulseBlock className="h-9 w-full" />
            </div>
            <div className="grid grid-cols-[1fr,100px] gap-2">
              <PulseBlock className="h-9 w-full" />
              <PulseBlock className="h-9 w-full" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <PulseBlock className="h-10 w-full" />
          <PulseBlock className="h-10 w-full" />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <PulseBlock className="h-9 w-full" />
          <PulseBlock className="h-9 w-full" />
          <PulseBlock className="h-9 w-full" />
        </div>
      </main>
    </div>
  )
}
