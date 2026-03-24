import { useEffect, useCallback, useState, useRef } from 'react'
import { X, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import type { ShotIteration } from '../../types/factory'

interface VideoLightboxProps {
  videos: ShotIteration[]
  activeIndex: number
  shotId: string
  onClose: () => void
}

export function VideoLightbox({ videos, activeIndex, shotId, onClose }: VideoLightboxProps) {
  const [currentIndex, setCurrentIndex] = useState(activeIndex)
  const [isPlaying, setIsPlaying] = useState(true)
  const [isMuted, setIsMuted] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const video = videos[currentIndex]

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) setCurrentIndex(i => i - 1)
      if (e.key === 'ArrowRight' && currentIndex < videos.length - 1) setCurrentIndex(i => i + 1)
      if (e.key === ' ') {
        e.preventDefault()
        if (videoRef.current) {
          if (videoRef.current.paused) {
            void videoRef.current.play()
          } else {
            videoRef.current.pause()
          }
        }
      }
      if (e.key === 'm') setIsMuted(m => !m)
    },
    [onClose, currentIndex, videos.length],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Auto-play when switching videos
  useEffect(() => {
    setIsPlaying(true)
    if (videoRef.current) {
      videoRef.current.currentTime = 0
      void videoRef.current.play()
    }
  }, [currentIndex])

  if (!video) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" onClick={onClose}>
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-zinc-800 px-6 py-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-bold text-zinc-100">{shotId}</span>
          <span className="text-sm text-zinc-400">
            Video {currentIndex + 1} of {videos.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (videoRef.current) {
                if (videoRef.current.paused) {
                  void videoRef.current.play()
                } else {
                  videoRef.current.pause()
                }
              }
            }}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          <button
            onClick={() => setIsMuted(m => !m)}
            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            onClick={onClose}
            className="ml-2 rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main video area */}
      <div
        className="flex flex-1 items-center justify-center overflow-hidden p-8"
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

        <video
          ref={videoRef}
          src={video.url}
          className="max-h-full max-w-full rounded-lg"
          autoPlay
          loop
          muted={isMuted}
          playsInline
          controls
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
        />

        {/* Right arrow */}
        {currentIndex < videos.length - 1 && (
          <button
            onClick={() => setCurrentIndex(i => i + 1)}
            className="absolute right-4 z-10 rounded-full bg-black/60 p-2 text-zinc-300 transition-colors hover:bg-black/80 hover:text-white"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom thumbnail strip (only if multiple videos) */}
      {videos.length > 1 && (
        <div
          className="border-t border-zinc-800 bg-zinc-950 px-6 py-3"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex gap-2 overflow-x-auto justify-center">
            {videos.map((v, idx) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`relative shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                  idx === currentIndex
                    ? 'border-violet-500 ring-1 ring-violet-500'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <video
                  src={v.url}
                  className="h-16 w-28 object-cover"
                  muted
                  preload="metadata"
                />
                <span className="absolute bottom-0.5 left-1 rounded bg-black/70 px-1 text-[10px] text-zinc-300">
                  v{idx + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
