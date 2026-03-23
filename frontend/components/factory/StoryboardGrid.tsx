import { AlertTriangle, Check, Square, CheckSquare } from 'lucide-react'
import type { FactoryShot, ValidationWarning } from '../../types/factory'
import { groupShotsByScene, parseDuration } from '../../lib/factory-manifest'

interface StoryboardGridProps {
  shots: FactoryShot[]
  selectedShotId: string | null
  selectedShotIds: Set<string>
  onSelect: (id: string) => void
  onToggleSelect: (id: string) => void
  onRangeSelect: (id: string) => void
  onDoubleClick: (id: string) => void
  gpuWarnings: ValidationWarning[]
}

const STATUS_BORDER: Record<string, string> = {
  idle: 'border-dashed border-zinc-700',
  'generating-frame': 'border-blue-500 animate-pulse',
  'frame-ready': 'border-blue-500',
  'rendering-video': 'border-blue-500 animate-pulse',
  'video-ready': 'border-green-500',
  approved: 'border-green-500',
  error: 'border-red-500',
  disabled: 'border-zinc-800 opacity-50',
}

const STATUS_DOT: Record<string, string> = {
  idle: 'bg-zinc-500',
  'generating-frame': 'bg-blue-400 animate-pulse',
  'frame-ready': 'bg-blue-400',
  'rendering-video': 'bg-blue-400 animate-pulse',
  'video-ready': 'bg-green-400',
  approved: 'bg-green-400',
  error: 'bg-red-400',
  disabled: 'bg-zinc-600',
}

export function StoryboardGrid({
  shots,
  selectedShotId,
  selectedShotIds,
  onSelect,
  onToggleSelect,
  onRangeSelect,
  onDoubleClick,
  gpuWarnings,
}: StoryboardGridProps) {
  const sceneGroups = groupShotsByScene(shots)
  const warningsByShot = new Map<string, ValidationWarning[]>()
  for (const w of gpuWarnings) {
    const existing = warningsByShot.get(w.shotId) || []
    existing.push(w)
    warningsByShot.set(w.shotId, existing)
  }

  const handleClick = (e: React.MouseEvent, shotId: string) => {
    if (e.ctrlKey || e.metaKey) {
      onToggleSelect(shotId)
    } else if (e.shiftKey) {
      onRangeSelect(shotId)
    } else {
      onSelect(shotId)
    }
  }

  return (
    <div className="flex flex-col gap-6 overflow-y-auto p-4">
      {[...sceneGroups.entries()].map(([sceneName, sceneShots]) => {
        const totalDuration = sceneShots.reduce(
          (sum, s) => sum + parseDuration(s.manifest.video.duration),
          0,
        )
        return (
          <div key={sceneName}>
            <div className="mb-3 flex items-baseline gap-3 border-b border-zinc-800 pb-2">
              <h3 className="text-sm font-semibold text-zinc-200">{sceneName}</h3>
              <span className="text-xs text-zinc-500">
                {sceneShots.length} shot{sceneShots.length !== 1 ? 's' : ''}
              </span>
              <span className="text-xs text-zinc-500">{totalDuration}s total</span>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {sceneShots.map(shot => {
                const isActive = shot.manifest.id === selectedShotId
                const isChecked = selectedShotIds.has(shot.manifest.id)
                const borderClass = STATUS_BORDER[shot.status] || STATUS_BORDER.idle
                const dotClass = STATUS_DOT[shot.status] || STATUS_DOT.idle
                const shotWarnings = warningsByShot.get(shot.manifest.id)
                const activeFrame = shot.frameIterations[shot.activeFrameIndex]

                return (
                  <button
                    key={shot.manifest.id}
                    type="button"
                    onClick={(e) => handleClick(e, shot.manifest.id)}
                    onDoubleClick={() => onDoubleClick(shot.manifest.id)}
                    className={`group relative flex flex-col overflow-hidden rounded-lg border bg-zinc-900 text-left transition-all ${borderClass} ${
                      isActive ? 'ring-2 ring-violet-500' : ''
                    } ${isChecked ? 'ring-2 ring-blue-400' : ''}`}
                  >
                    {/* Thumbnail area */}
                    <div className="relative aspect-video w-full bg-zinc-800">
                      {activeFrame ? (
                        <img
                          src={activeFrame.url}
                          alt={shot.manifest.id}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                          No frame
                        </div>
                      )}
                      {/* Shot ID badge */}
                      <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
                        {shot.manifest.id}
                      </span>
                      {/* Multi-select checkbox */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onToggleSelect(shot.manifest.id)
                        }}
                        className={`absolute right-1.5 top-1.5 rounded p-0.5 transition-opacity ${
                          isChecked
                            ? 'bg-blue-500 opacity-100'
                            : 'bg-black/50 opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        {isChecked ? (
                          <CheckSquare className="h-3.5 w-3.5 text-white" />
                        ) : (
                          <Square className="h-3.5 w-3.5 text-white/70" />
                        )}
                      </button>
                      {/* Approved badge */}
                      {shot.status === 'approved' && (
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-green-500 p-0.5">
                          <Check className="h-3 w-3 text-white" />
                        </span>
                      )}
                      {/* GPU warning badge */}
                      {shotWarnings && shotWarnings.length > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-yellow-500/80 p-0.5">
                          <AlertTriangle className="h-3 w-3 text-black" />
                        </span>
                      )}
                    </div>

                    {/* Card info */}
                    <div className="flex flex-col gap-1 p-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                        <span className="truncate text-xs text-zinc-400">
                          {shot.status.replace('-', ' ')}
                        </span>
                        <span className="ml-auto text-[10px] text-zinc-500">
                          {parseDuration(shot.manifest.video.duration)}s
                        </span>
                      </div>
                      <p className="line-clamp-2 text-xs text-zinc-300">
                        {shot.manifest.description}
                      </p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
