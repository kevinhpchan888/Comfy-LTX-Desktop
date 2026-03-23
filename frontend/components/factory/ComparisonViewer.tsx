import { useEffect, useCallback, useState } from 'react'
import { X, Check } from 'lucide-react'
import type { FactoryShot } from '../../types/factory'

interface ComparisonViewerProps {
  shot: FactoryShot
  onClose: () => void
  onApprove: (index: number) => void
}

export function ComparisonViewer({ shot, onClose, onApprove }: ComparisonViewerProps) {
  const [activeIndex, setActiveIndex] = useState(
    shot.activeVideoIndex >= 0 ? shot.activeVideoIndex : 0,
  )

  const activeIteration = shot.videoIterations[activeIndex]

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-zinc-100">
            {shot.manifest.id}
          </span>
          <span className="text-sm text-zinc-400">{shot.manifest.description}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Main video player */}
      <div className="flex flex-1 items-center justify-center p-8">
        {activeIteration ? (
          <video
            key={activeIteration.id}
            src={activeIteration.url}
            controls
            autoPlay
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-zinc-500">
            <p className="text-sm">No video iterations available</p>
          </div>
        )}
      </div>

      {/* Bottom thumbnail strip */}
      <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex gap-2 overflow-x-auto">
            {shot.videoIterations.map((iter, idx) => (
              <button
                key={iter.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                  idx === activeIndex
                    ? 'border-violet-500 ring-1 ring-violet-500'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <video
                  src={iter.url}
                  muted
                  preload="metadata"
                  className="h-16 w-28 object-cover"
                />
                <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 text-[10px] text-zinc-300">
                  v{idx + 1}
                </span>
              </button>
            ))}
          </div>

          <div className="ml-auto">
            <button
              onClick={() => onApprove(activeIndex)}
              disabled={!activeIteration}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Approve This Take
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
