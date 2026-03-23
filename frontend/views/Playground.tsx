import { useState, useRef, useEffect } from 'react'
import { Sparkles, Trash2, Square, ImageIcon, ArrowLeft, Scissors, Upload, ListPlus, Clock, Loader2, CheckCircle2, AlertCircle, XCircle, ChevronUp, X } from 'lucide-react'
import { logger } from '../lib/logger'
import { ImageUploader } from '../components/ImageUploader'
import { AudioUploader } from '../components/AudioUploader'
import { VideoPlayer } from '../components/VideoPlayer'
import { ImageResult } from '../components/ImageResult'
import { SettingsPanel, type GenerationSettings } from '../components/SettingsPanel'
import { ModeTabs, type GenerationMode } from '../components/ModeTabs'
import { LtxLogo } from '../components/LtxLogo'
import { Textarea } from '../components/ui/textarea'
import { Button } from '../components/ui/button'
import { useGeneration } from '../contexts/GenerationContext'
import type { QueueItem, QueueItemParams } from '../contexts/GenerationContext'
import { useRetake } from '../hooks/use-retake'
import { useBackend } from '../hooks/use-backend'
import { useProjects } from '../contexts/ProjectContext'
import { useAppSettings } from '../contexts/AppSettingsContext'
import { fileUrlToPath } from '../lib/url-to-path'
import { RetakePanel } from '../components/RetakePanel'

const DEFAULT_SETTINGS: GenerationSettings = {
  model: 'fast',
  duration: 5,
  videoResolution: '540p',
  fps: 24,
  audio: true,
  cameraMotion: 'none',
  aspectRatio: '16:9',
  // Image settings
  imageResolution: '1080p',
  imageAspectRatio: '16:9',
  imageSteps: 20,
}

export function Playground() {
  const { goHome } = useProjects()
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings()
  const [mode, setMode] = useState<GenerationMode>('text-to-video')
  const [prompt, setPrompt] = useState('')
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [selectedMiddleImage, setSelectedMiddleImage] = useState<string | null>(null)
  const [selectedLastImage, setSelectedLastImage] = useState<string | null>(null)
  const [selectedAudio, setSelectedAudio] = useState<string | null>(null)
  const [firstStrength, setFirstStrength] = useState(1)
  const [middleStrength, setMiddleStrength] = useState(1)
  const [lastStrength, setLastStrength] = useState(1)
  const [preserveAspectRatio, setPreserveAspectRatio] = useState(false)
  const [settings, setSettings] = useState<GenerationSettings>(() => ({
    ...DEFAULT_SETTINGS,
    filmGrain: appSettings.filmGrain,
    filmGrainIntensity: appSettings.filmGrainIntensity,
    filmGrainSize: appSettings.filmGrainSize,
  }))

  const { status } = useBackend()

  const handleSettingsChange = (next: GenerationSettings) => {
    setSettings(next)
    if (
      next.filmGrain !== settings.filmGrain ||
      next.filmGrainIntensity !== settings.filmGrainIntensity ||
      next.filmGrainSize !== settings.filmGrainSize
    ) {
      updateAppSettings({
        filmGrain: next.filmGrain ?? false,
        filmGrainIntensity: next.filmGrainIntensity ?? 0.05,
        filmGrainSize: next.filmGrainSize ?? 1.2,
      })
    }
  }

  // Force pro model when audio is attached (A2V only supports pro)
  useEffect(() => {
    if (selectedAudio && mode !== 'text-to-image') {
      setSettings(prev => prev.model !== 'pro' ? { ...prev, model: 'pro' } : prev)
    }
  }, [mode, selectedAudio])

  // Handle mode change
  const handleModeChange = (newMode: GenerationMode) => {
    setMode(newMode)
  }
  const {
    isGenerating,
    progress,
    statusMessage,
    videoUrl,
    videoPath,
    imageUrl,
    error: generationError,
    generate,
    generateImage,
    cancel,
    reset,
    queue,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    clearQueue,
    cancelQueue,
    isProcessingQueue,
  } = useGeneration()

  const {
    submitRetake,
    resetRetake,
    isRetaking,
    retakeStatus,
    retakeError,
    retakeResult,
  } = useRetake()

  const [retakeInput, setRetakeInput] = useState({
    videoUrl: null as string | null,
    videoPath: null as string | null,
    startTime: 0,
    duration: 0,
    videoDuration: 0,
    ready: false,
  })
  const [retakePanelKey, setRetakePanelKey] = useState(0)
  
  // Ref to store generated image URL for "Create video" flow
  const generatedImageRef = useRef<string | null>(null)

  const handleGenerate = () => {
    if (mode === 'retake') {
      if (!retakeInput.videoPath || retakeInput.duration < 2) return
      submitRetake({
        videoPath: retakeInput.videoPath,
        startTime: retakeInput.startTime,
        duration: retakeInput.duration,
        prompt,
        mode: 'replace_audio_and_video',
      })
      return
    }

    if (mode === 'text-to-image') {
      if (!prompt.trim()) return
      generateImage(prompt, settings)
    } else {
      // Auto-detect: if image is loaded → I2V, otherwise → T2V
      if (!prompt.trim()) return
      const imagePath = selectedImage ? fileUrlToPath(selectedImage) : null
      const middleImagePath = selectedMiddleImage ? fileUrlToPath(selectedMiddleImage) : null
      const lastImagePath = selectedLastImage ? fileUrlToPath(selectedLastImage) : null
      const audioPath = selectedAudio ? fileUrlToPath(selectedAudio) : null
      const effectiveSettings = { ...settings }
      if (audioPath) effectiveSettings.model = 'pro'
      generate(prompt, imagePath, effectiveSettings, audioPath, middleImagePath, lastImagePath, {
        first: firstStrength,
        middle: middleStrength,
        last: lastStrength,
      }, undefined, preserveAspectRatio)
    }
  }
  
  const handleAddToQueue = () => {
    if (!prompt.trim() || mode === 'retake') return
    const imagePath = selectedImage ? fileUrlToPath(selectedImage) : null
    const middleImagePath = selectedMiddleImage ? fileUrlToPath(selectedMiddleImage) : null
    const lastImagePath = selectedLastImage ? fileUrlToPath(selectedLastImage) : null
    const audioPath = selectedAudio ? fileUrlToPath(selectedAudio) : null

    const params: QueueItemParams = mode === 'text-to-image'
      ? { type: 'image', prompt, settings }
      : {
          type: 'video',
          prompt,
          settings: audioPath ? { ...settings, model: 'pro' } : settings,
          imagePath,
          middleImagePath,
          lastImagePath,
          audioPath,
          strengths: { first: firstStrength, middle: middleStrength, last: lastStrength },
          preserveAspectRatio,
        }

    addToQueue(params)
    setPrompt('')
  }

  // Handle "Create video" from generated image
  const handleCreateVideoFromImage = () => {
    if (!imageUrl) {
      logger.error('No image URL available')
      return
    }

    // imageUrl is already a file:// URL — just pass it as the selected image path
    setSelectedImage(imageUrl)
    setMode('image-to-video')
    generatedImageRef.current = imageUrl
  }

  const handleClearAll = () => {
    setPrompt('')
    setSelectedImage(null)
    setSelectedMiddleImage(null)
    setSelectedLastImage(null)
    setSelectedAudio(null)
    setFirstStrength(1)
    setMiddleStrength(1)
    setLastStrength(1)
    setSettings({ ...DEFAULT_SETTINGS })
    if (mode !== 'text-to-image') setMode('text-to-video')
    setRetakeInput({
      videoUrl: null,
      videoPath: null,
      startTime: 0,
      duration: 0,
      videoDuration: 0,
      ready: false,
    })
    setRetakePanelKey((prev) => prev + 1)
    resetRetake()
    reset()
  }

  const [loadError, setLoadError] = useState<string | null>(null)

  const handleLoadSettings = async () => {
    setLoadError(null)
    const files = await window.electronAPI.showOpenFileDialog({
      title: 'Load settings from video',
      filters: [{ name: 'Video Files', extensions: ['mp4', 'webm', 'mov'] }],
    })
    if (!files || files.length === 0) return
    const metadata = await window.electronAPI.readVideoMetadata(files[0])
    if (!metadata) {
      setLoadError('No generation settings found in this video.')
      return
    }
    if (typeof metadata.prompt === 'string') setPrompt(metadata.prompt)
    setSettings(prev => ({
      ...prev,
      ...(typeof metadata.duration === 'number' && { duration: metadata.duration }),
      ...(typeof metadata.fps === 'number' && { fps: metadata.fps }),
      ...(typeof metadata.resolution === 'string' && { videoResolution: metadata.resolution }),
      ...(typeof metadata.aspectRatio === 'string' && { aspectRatio: metadata.aspectRatio }),
      ...(typeof metadata.cameraMotion === 'string' && { cameraMotion: metadata.cameraMotion }),
      ...(typeof metadata.spatialUpscale === 'boolean' && { spatialUpscale: metadata.spatialUpscale }),
      ...(typeof metadata.temporalUpscale === 'boolean' && { temporalUpscale: metadata.temporalUpscale }),
      ...(typeof metadata.filmGrain === 'boolean' && { filmGrain: metadata.filmGrain }),
      ...(typeof metadata.filmGrainIntensity === 'number' && { filmGrainIntensity: metadata.filmGrainIntensity }),
      ...(typeof metadata.filmGrainSize === 'number' && { filmGrainSize: metadata.filmGrainSize }),
    }))
    if (typeof metadata.firstStrength === 'number') setFirstStrength(metadata.firstStrength)
    if (typeof metadata.lastStrength === 'number') setLastStrength(metadata.lastStrength)
    setMode('text-to-video')
    setSelectedImage(null)
    setSelectedLastImage(null)
    setSelectedAudio(null)
    reset()
  }

  const isRetakeMode = mode === 'retake'
  const isVideoMode = mode === 'text-to-video' || mode === 'image-to-video'
  const isBusy = isRetakeMode ? isRetaking : isGenerating
  const canGenerate = status.connected && !isBusy && (
    isRetakeMode
      ? retakeInput.ready && !!retakeInput.videoPath
      : !!prompt.trim()
  )

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <button 
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
            title="Back to Home"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          <div className="flex items-center gap-2.5">
            <LtxLogo className="h-6 w-auto text-white" />
            <span className="text-zinc-400 text-base font-medium tracking-wide leading-none pt-1 pl-1.5">Playground</span>
          </div>
        </div>
        
        <div className="flex items-center gap-4 pr-20">
          {/* Connection status */}
          <div className="text-sm text-zinc-500">
            {status.connected ? 'ComfyUI Connected' : 'ComfyUI Disconnected'}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel - Controls */}
        <div className="w-[500px] min-h-0 border-r border-zinc-800 p-6 overflow-y-auto">
          <div className="space-y-6">
            {/* Mode Tabs */}
            <ModeTabs
              mode={mode}
              onModeChange={handleModeChange}
              disabled={isBusy}
            />

            {/* Image Upload - Always shown in video mode (optional: makes it I2V) */}
            {isVideoMode && !isRetakeMode && (
              <>
                <ImageUploader
                  label="First Frame"
                  selectedImage={selectedImage}
                  onImageSelect={setSelectedImage}
                  strength={firstStrength}
                  onStrengthChange={setFirstStrength}
                />

                <ImageUploader
                  label="Middle Frame"
                  selectedImage={selectedMiddleImage}
                  onImageSelect={setSelectedMiddleImage}
                  strength={middleStrength}
                  onStrengthChange={setMiddleStrength}
                />

                <ImageUploader
                  label="Last Frame"
                  selectedImage={selectedLastImage}
                  onImageSelect={setSelectedLastImage}
                  strength={lastStrength}
                  onStrengthChange={setLastStrength}
                />
                <AudioUploader
                  selectedAudio={selectedAudio}
                  onAudioSelect={setSelectedAudio}
                />

                {(selectedImage || selectedMiddleImage || selectedLastImage) && (
                  <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={preserveAspectRatio}
                      onChange={(e) => setPreserveAspectRatio(e.target.checked)}
                      className="rounded border-zinc-600 bg-zinc-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    Preserve aspect ratio
                  </label>
                )}
              </>
            )}

            {isRetakeMode && (
              <RetakePanel
                resetKey={retakePanelKey}
                isProcessing={isRetaking}
                processingStatus={retakeStatus}
                onChange={(data) => setRetakeInput(data)}
              />
            )}

            {/* Prompt Input */}
            <Textarea
              label="Prompt"
              placeholder="Write a prompt..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              helperText="Longer, detailed prompts lead to better, more accurate results."
              charCount={prompt.length}
              maxChars={5000}
              disabled={isBusy}
            />

            {/* Settings */}
            {!isRetakeMode && (
              <SettingsPanel
                settings={settings}
                onSettingsChange={handleSettingsChange}
                disabled={isBusy}
                mode={mode}
                hasAudio={!!selectedAudio}
              />
            )}

            {/* Error Display */}
            {loadError && (
              <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-sm">
                <span className="text-yellow-400">{loadError}</span>
              </div>
            )}
            {(generationError || retakeError) && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm">
                {(generationError || retakeError)!.includes('TEXT_ENCODING_NOT_CONFIGURED') ? (
                  <div className="space-y-2">
                    <p className="text-red-400 font-medium">Text encoding not configured</p>
                    <p className="text-red-400/80">
                      To generate videos, you need to set up text encoding in Settings.
                    </p>
                  </div>
                ) : (generationError || retakeError)!.includes('TEXT_ENCODER_NOT_DOWNLOADED') ? (
                  <div className="space-y-2">
                    <p className="text-red-400 font-medium">Text encoder not downloaded</p>
                    <p className="text-red-400/80">
                      The local text encoder needs to be downloaded (~25 GB).
                    </p>
                  </div>
                ) : (
                  <span className="text-red-400">{generationError || retakeError}</span>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <Button
                variant="outline"
                onClick={handleLoadSettings}
                disabled={isBusy}
                className="flex items-center gap-2 border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
                title="Load settings from a previously generated video"
              >
                <Upload className="h-4 w-4" />
                Load
              </Button>
              <Button
                variant="outline"
                onClick={handleClearAll}
                disabled={isBusy}
                className="flex items-center gap-2 border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700"
              >
                <Trash2 className="h-4 w-4" />
                Clear all
              </Button>

              {isGenerating ? (
                <Button
                  onClick={cancel}
                  className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 text-white"
                >
                  <Square className="h-4 w-4" />
                  Stop generation
                </Button>
              ) : (
                <>
                  <Button
                    onClick={handleGenerate}
                    disabled={!canGenerate}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white disabled:bg-zinc-700 disabled:text-zinc-500"
                  >
                    {isRetakeMode ? (
                      <>
                        <Scissors className="h-4 w-4" />
                        {isRetaking ? 'Retaking...' : 'Retake'}
                      </>
                    ) : mode === 'text-to-image' ? (
                      <>
                        <ImageIcon className="h-4 w-4" />
                        Generate image
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Generate video
                      </>
                    )}
                  </Button>
                  {!isRetakeMode && (
                    <Button
                      variant="outline"
                      onClick={handleAddToQueue}
                      disabled={!canGenerate}
                      className="flex items-center gap-1.5 border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-700 disabled:bg-zinc-700 disabled:text-zinc-500"
                      title="Add to batch queue"
                    >
                      <ListPlus className="h-4 w-4" />
                      Queue
                      {queue.filter(q => q.status === 'pending' || q.status === 'generating').length > 0 && (
                        <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-violet-600 text-white text-[10px] leading-none">
                          {queue.filter(q => q.status === 'pending' || q.status === 'generating').length}
                        </span>
                      )}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel - Result Preview */}
        <div className="flex-1 p-6">
          {mode === 'text-to-image' ? (
            <ImageResult
              imageUrl={imageUrl}
              isGenerating={isGenerating}
              progress={progress}
              statusMessage={statusMessage}
              onCreateVideo={handleCreateVideoFromImage}
            />
          ) : mode === 'retake' ? (
            <VideoPlayer
              videoUrl={retakeResult?.videoUrl || null}
              videoPath={retakeResult?.videoPath || null}
              videoResolution={settings.videoResolution}
              isGenerating={isRetaking}
              progress={0}
              statusMessage={retakeStatus}
            />
          ) : (
            <VideoPlayer
              videoUrl={videoUrl}
              videoPath={videoPath}
              videoResolution={settings.videoResolution}
              isGenerating={isGenerating}
              progress={progress}
              statusMessage={statusMessage}
            />
          )}
        </div>
      </main>

      {/* Batch Queue Panel */}
      {queue.length > 0 && (
        <PlaygroundBatchQueuePanel
          queue={queue}
          onRemove={removeFromQueue}
          onReorder={reorderQueue}
          onClear={clearQueue}
          onCancel={cancelQueue}
          isProcessing={isProcessingQueue}
        />
      )}
    </div>
  )
}

function PlaygroundBatchQueuePanel({
  queue,
  onRemove,
  onReorder,
  onClear,
  onCancel,
  isProcessing,
}: {
  queue: QueueItem[]
  onRemove: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  onClear: () => void
  onCancel: () => void
  isProcessing: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const activeCount = queue.filter(q => q.status === 'pending' || q.status === 'generating').length
  const completedCount = queue.filter(q => q.status === 'complete').length
  const errorCount = queue.filter(q => q.status === 'error').length

  const statusIcon = (status: QueueItem['status']) => {
    switch (status) {
      case 'pending': return <Clock className="h-3.5 w-3.5 text-zinc-500" />
      case 'generating': return <Loader2 className="h-3.5 w-3.5 text-violet-400 animate-spin" />
      case 'complete': return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
      case 'error': return <AlertCircle className="h-3.5 w-3.5 text-red-400" />
      case 'cancelled': return <XCircle className="h-3.5 w-3.5 text-zinc-500" />
    }
  }

  const canDrag = (item: QueueItem) => item.status === 'pending'

  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!canDrag(queue[index])) { e.preventDefault(); return }
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragIndex === null) return
    setDragOverIndex(index)
  }

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault()
    if (dragIndex !== null && dragIndex !== toIndex) {
      onReorder(dragIndex, toIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const handleDragEnd = () => {
    setDragIndex(null)
    setDragOverIndex(null)
  }

  const moveItem = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    if (targetIndex < 0 || targetIndex >= queue.length) return
    onReorder(index, targetIndex)
  }

  return (
    <div className="fixed bottom-6 right-6 w-[360px] z-20">
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ListPlus className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-white">Batch Queue</span>
            <span className="text-xs text-zinc-500">
              {activeCount > 0 ? `${activeCount} remaining` : `${completedCount} done`}
              {errorCount > 0 && ` · ${errorCount} failed`}
            </span>
          </div>
          <ChevronUp className={`h-4 w-4 text-zinc-500 transition-transform ${expanded ? '' : 'rotate-180'}`} />
        </button>

        {expanded && (
          <>
            <div className="max-h-[280px] overflow-y-auto border-t border-zinc-800/60">
              {queue.map((item, index) => (
                <div
                  key={item.id}
                  draggable={canDrag(item)}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-start gap-2 px-3 py-2.5 border-b border-zinc-800/40 transition-colors ${
                    item.status === 'generating' ? 'bg-violet-500/5' : ''
                  } ${dragOverIndex === index && dragIndex !== index ? 'border-t-2 border-t-violet-500' : ''}
                  ${dragIndex === index ? 'opacity-40' : ''}
                  ${canDrag(item) ? 'cursor-grab active:cursor-grabbing' : ''}`}
                >
                  <div className="flex flex-col items-center gap-0.5 mt-0.5 flex-shrink-0">
                    {canDrag(item) ? (
                      <>
                        <button
                          onClick={() => moveItem(index, 'up')}
                          disabled={index === 0 || queue[index - 1]?.status === 'generating'}
                          className="p-0 text-zinc-600 hover:text-zinc-400 disabled:text-zinc-800 disabled:cursor-default transition-colors"
                          title="Move up"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => moveItem(index, 'down')}
                          disabled={index === queue.length - 1}
                          className="p-0 text-zinc-600 hover:text-zinc-400 disabled:text-zinc-800 disabled:cursor-default transition-colors"
                          title="Move down"
                        >
                          <ChevronUp className="h-3 w-3 rotate-180" />
                        </button>
                      </>
                    ) : (
                      <div className="mt-0.5">
                        {statusIcon(item.status)}
                      </div>
                    )}
                  </div>
                  {canDrag(item) && (
                    <div className="mt-1 flex-shrink-0">
                      {statusIcon(item.status)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase font-medium text-zinc-600">
                        #{index + 1} {item.params.type}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 truncate mt-0.5">{item.params.prompt}</p>
                    {item.status === 'generating' && item.progress > 0 && (
                      <div className="w-full h-1 bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                        <div className="h-full bg-violet-500 transition-all" style={{ width: `${item.progress}%` }} />
                      </div>
                    )}
                    {item.status === 'error' && item.error && (
                      <p className="text-[10px] text-red-400 mt-0.5 truncate">{item.error}</p>
                    )}
                  </div>
                  {item.status === 'pending' && (
                    <button
                      onClick={() => onRemove(item.id)}
                      className="mt-0.5 p-0.5 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors flex-shrink-0"
                      title="Remove from queue"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-800/60">
              <button
                onClick={onClear}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Clear All
              </button>
              {isProcessing && (
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
                >
                  <Square className="h-3 w-3" />
                  Stop Queue
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
