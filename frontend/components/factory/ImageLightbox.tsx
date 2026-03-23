import { useEffect, useCallback, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import type { ShotIteration } from '../../types/factory'

interface ImageLightboxProps {
  frames: ShotIteration[]
  activeIndex: number
  shotId: string
  onClose: () => void
}

export function ImageLightbox({ frames, activeIndex, shotId, onClose }: ImageLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(activeIndex)
  const [zoom, setZoom] = useState(1)

  const frame = frames[currentIndex]

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) setCurrentIndex(i => i - 1)
      if (e.key === 'ArrowRight' && currentIndex < frames.length - 1) setCurrentIndex(i => i + 1)
      if (e.key === '+' || e.key === '=') setZoom(z => Math.min(z + 0.25, 4))
      if (e.key === '-') setZoom(z => Math.max(z - 0.25, 0.5))
      if (e.key === '0') setZoom(1)
    },
    [onClose, currentIndex, frames.length],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Reset zoom when switching frames
  useEffect(() => {
    setZoom(1)
  }, [currentIndex])

  if (!frame) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-zinc-800 px-6 py-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-zinc-100">{shotId}</span>
          <span className="text-sm text-zinc-400">
            Frame {currentIndex + 1} of {frames.length}
          </span>
          {frame.seed !== undefined && (
            <span className="text-xs text-zinc-500">Seed: {frame.seed}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom(z => Math.max(z - 0.25, 0.5))}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Zoom out (-)"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="min-w-[3rem] text-center text-xs text-zinc-400">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(z + 0.25, 4))}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title="Zoom in (+)"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={onClose}
            className="ml-2 rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main image area */}
      <div
        className="flex flex-1 items-center justify-center overflow-auto p-8"
        onClick={e => e.stopPropagation()}
      >
        {/* Left arrow */}
        {currentIndex > 0 && (
          <button
            onClick={() => setCurrentIndex(i => i - 1)}
            className="absolute left-4 z-10 rounded-full bg-black/60 p-2 text-zinc-300 transition-colors hover:bg-black/80 hover:text-white"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <img
          src={frame.url}
          alt={`Frame ${currentIndex + 1}`}
          className="max-h-full max-w-full rounded-lg transition-transform"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
          draggable={false}
        />

        {/* Right arrow */}
        {currentIndex < frames.length - 1 && (
          <button
            onClick={() => setCurrentIndex(i => i + 1)}
            className="absolute right-4 z-10 rounded-full bg-black/60 p-2 text-zinc-300 transition-colors hover:bg-black/80 hover:text-white"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom thumbnail strip (only if multiple frames) */}
      {frames.length > 1 && (
        <div
          className="border-t border-zinc-800 bg-zinc-950 px-6 py-3"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex gap-2 overflow-x-auto justify-center">
            {frames.map((f, idx) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                  idx === currentIndex
                    ? 'border-violet-500 ring-1 ring-violet-500'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <img
                  src={f.url}
                  alt={`Frame ${idx + 1}`}
                  className="h-16 w-28 object-cover"
                />
                <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 text-[10px] text-zinc-300">
                  #{idx + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
