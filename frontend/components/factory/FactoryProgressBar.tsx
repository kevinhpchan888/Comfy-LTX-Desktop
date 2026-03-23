import { X } from 'lucide-react'
import type { FactoryPhase, FactoryProgress } from '../../types/factory'
import type { getShotStats } from '../../lib/factory-manifest'

interface FactoryProgressBarProps {
  phase: FactoryPhase
  progress: FactoryProgress
  stats: ReturnType<typeof getShotStats>
  onCancel: () => void
}

function formatElapsed(startTime: number | null): string {
  if (!startTime) return '0:00'
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function FactoryProgressBar({ phase, progress, stats, onCancel }: FactoryProgressBarProps) {
  const isActive = phase !== 'idle'
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0

  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-2">
      {isActive ? (
        <div className="flex items-center gap-3">
          {/* Progress bar */}
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium text-zinc-200">{pct}%</span>
          {progress.currentShotId && (
            <span className="shrink-0 font-mono text-[11px] text-zinc-400">
              {progress.currentShotId}
            </span>
          )}
          <span className="shrink-0 text-[11px] text-zinc-500">
            {formatElapsed(progress.startTime)}
          </span>
          <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
            {phase.replace('-', ' ')}
          </span>
          <button
            onClick={onCancel}
            className="shrink-0 rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-red-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="font-medium text-zinc-300">Ready</span>
          <Separator />
          <span>{stats.total} shots</span>
          <Separator />
          <span>{stats.framesReady} frames</span>
          <Separator />
          <span>{stats.rendered} rendered</span>
          <Separator />
          <span className="text-green-400">{stats.approved} approved</span>
          {stats.errors > 0 && (
            <>
              <Separator />
              <span className="text-red-400">{stats.errors} errors</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Separator() {
  return <span className="text-zinc-700">|</span>
}
