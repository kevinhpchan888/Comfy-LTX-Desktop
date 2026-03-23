import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { GenerationSettings } from '../components/SettingsPanel'

interface GenerationState {
  isGenerating: boolean
  progress: number
  statusMessage: string
  videoUrl: string | null
  videoPath: string | null
  enhancedPrompt: string | null
  imageUrl: string | null
  imageUrls: string[]
  error: string | null
  iterationCurrent: number
  iterationTotal: number
}

interface GenerationProgress {
  status: string
  phase: string
  progress: number
  currentStep: number | null
  totalSteps: number | null
}

export type QueueItemStatus = 'pending' | 'generating' | 'complete' | 'error' | 'cancelled'

export interface QueueItemParams {
  type: 'video' | 'image'
  prompt: string
  settings: GenerationSettings
  imagePath?: string | null
  middleImagePath?: string | null
  lastImagePath?: string | null
  audioPath?: string | null
  strengths?: { first?: number; middle?: number; last?: number }
  projectName?: string
  preserveAspectRatio?: boolean
  imageStrength?: number
}

export interface QueueItem {
  id: string
  params: QueueItemParams
  status: QueueItemStatus
  progress: number
  statusMessage: string
  videoUrl: string | null
  videoPath: string | null
  imageUrl: string | null
  error: string | null
  addedAt: number
}

export interface GenerationContextType extends GenerationState {
  generate: (prompt: string, imagePath: string | null, settings: GenerationSettings, audioPath?: string | null, middleImagePath?: string | null, lastImagePath?: string | null, strengths?: { first?: number; middle?: number; last?: number }, projectName?: string, preserveAspectRatio?: boolean) => Promise<void>
  generateImage: (prompt: string, settings: GenerationSettings, imagePath?: string | null, strength?: number, projectName?: string) => Promise<void>
  cancel: () => void
  reset: () => void
  // Batch queue
  queue: QueueItem[]
  addToQueue: (params: QueueItemParams) => void
  removeFromQueue: (id: string) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  clearQueue: () => void
  cancelQueue: () => void
  isProcessingQueue: boolean
  queuePosition: number // 0-based index of currently processing item, -1 if not processing
  /** Returns completed video/image paths from the queue in order */
  getCompletedResults: () => Array<{ path: string; url: string; type: 'video' | 'image'; prompt: string }>
}

const GenerationContext = createContext<GenerationContextType | null>(null)

function getPhaseMessage(phase: string): string {
  switch (phase) {
    case 'complete':
      return 'Complete!'
    case 'error':
      return 'Error'
    case 'cancelled':
      return 'Cancelled'
    default:
      return phase || 'Generating...'
  }
}

const INITIAL_STATE: GenerationState = {
  isGenerating: false,
  progress: 0,
  statusMessage: '',
  videoUrl: null,
  videoPath: null,
  enhancedPrompt: null,
  imageUrl: null,
  imageUrls: [],
  error: null,
  iterationCurrent: 0,
  iterationTotal: 0,
}

let nextQueueId = 1

export function GenerationProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GenerationState>(INITIAL_STATE)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [isProcessingQueue, setIsProcessingQueue] = useState(false)
  const [queuePosition, setQueuePosition] = useState(-1)
  const cancelledRef = useRef(false)
  const queueCancelledRef = useRef(false)
  const processingQueueRef = useRef(false)

  const generate = useCallback(async (
    prompt: string,
    imagePath: string | null,
    settings: GenerationSettings,
    audioPath?: string | null,
    middleImagePath?: string | null,
    lastImagePath?: string | null,
    strengths?: { first?: number; middle?: number; last?: number },
    projectName?: string,
    preserveAspectRatio?: boolean,
  ) => {
    const iterations = settings.iterations || 1

    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: iterations > 1 ? `Generating video (1/${iterations})...` : 'Generating video...',
      videoUrl: null,
      videoPath: null,
      enhancedPrompt: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
      iterationCurrent: 1,
      iterationTotal: iterations,
    })

    cancelledRef.current = false
    let progressInterval: ReturnType<typeof setInterval> | null = null

    try {
      const iterPrefix = (i: number) => iterations > 1 ? `(${i}/${iterations}) ` : ''

      const pollProgress = (iteration: number) => async () => {
        if (cancelledRef.current) return
        try {
          const data: GenerationProgress = await window.electronAPI.getGenerationProgress()
          if (cancelledRef.current) return
          setState(prev => ({
            ...prev,
            progress: data.progress,
            statusMessage: iterPrefix(iteration) + getPhaseMessage(data.phase),
          }))
        } catch {
          // Ignore polling errors
        }
      }

      const is4K = settings.videoResolution === '4K'
      const generateParams = {
        prompt,
        imagePath,
        middleImagePath,
        lastImagePath,
        audioPath,
        resolution: is4K ? '1080p' : settings.videoResolution,
        aspectRatio: settings.aspectRatio || '16:9',
        duration: settings.duration,
        fps: settings.fps,
        cameraMotion: settings.cameraMotion,
        spatialUpscale: settings.spatialUpscale,
        upscaleDenoise: settings.upscaleDenoise,
        temporalUpscale: settings.temporalUpscale,
        promptEnhance: settings.promptEnhance,
        filmGrain: settings.filmGrain,
        filmGrainIntensity: settings.filmGrainIntensity,
        filmGrainSize: settings.filmGrainSize,
        firstStrength: strengths?.first,
        middleStrength: strengths?.middle,
        lastStrength: strengths?.last,
        rtxSuperRes: is4K,
        preserveAspectRatio,
        projectName,
      }

      for (let i = 1; i <= iterations; i++) {
        if (cancelledRef.current) return

        setState(prev => ({
          ...prev,
          iterationCurrent: i,
          statusMessage: iterPrefix(i) + 'Generating video...',
          progress: 0,
        }))

        progressInterval = setInterval(pollProgress(i), 500)

        const result = await window.electronAPI.generateVideo(generateParams)

        if (progressInterval) {
          clearInterval(progressInterval)
          progressInterval = null
        }

        if (cancelledRef.current) return

        if (result.status === 'complete' && result.video_path) {
          const videoPathNormalized = result.video_path.replace(/\\/g, '/')
          const fileUrl = videoPathNormalized.startsWith('/') ? `file://${videoPathNormalized}` : `file:///${videoPathNormalized}`

          const isLast = i === iterations
          setState({
            isGenerating: !isLast,
            progress: 100,
            statusMessage: isLast ? 'Complete!' : iterPrefix(i) + 'Complete!',
            videoUrl: fileUrl,
            videoPath: result.video_path,
            enhancedPrompt: result.enhanced_prompt ?? null,
            imageUrl: null,
            imageUrls: [],
            error: null,
            iterationCurrent: i,
            iterationTotal: iterations,
          })

          // Brief pause between iterations to let archive effects process
          if (!isLast) {
            await new Promise(r => setTimeout(r, 100))
          }
        } else if (result.status === 'cancelled') {
          setState(prev => ({
            ...prev,
            isGenerating: false,
            statusMessage: 'Cancelled',
          }))
          return
        } else if (result.error) {
          throw new Error(result.error)
        }
      }

    } catch (error) {
      if (cancelledRef.current) {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          statusMessage: 'Cancelled',
        }))
      } else {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
      }
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
    }
  }, [])

  const cancel = useCallback(async () => {
    cancelledRef.current = true

    try {
      await window.electronAPI.cancelGeneration()
    } catch {
      // Ignore errors from cancel request
    }

    setState(prev => ({
      ...prev,
      isGenerating: false,
      statusMessage: 'Cancelled',
    }))
  }, [])

  const generateImage = useCallback(async (
    prompt: string,
    settings: GenerationSettings,
    imagePath?: string | null,
    strength?: number,
    projectName?: string,
  ) => {
    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: 'Generating image...',
      videoUrl: null,
      videoPath: null,
      enhancedPrompt: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
      iterationCurrent: 0,
      iterationTotal: 0,
    })

    cancelledRef.current = false
    let progressInterval: ReturnType<typeof setInterval> | null = null

    try {
      const pollProgress = async () => {
        if (cancelledRef.current) return
        try {
          const data: GenerationProgress = await window.electronAPI.getGenerationProgress()
          if (cancelledRef.current) return
          setState(prev => ({
            ...prev,
            progress: data.progress,
            statusMessage: getPhaseMessage(data.phase),
          }))
        } catch {
          // Ignore polling errors
        }
      }

      progressInterval = setInterval(pollProgress, 500)

      const result = await window.electronAPI.generateVideo({
        prompt,
        imagePath,
        resolution: '1080p',
        aspectRatio: settings.imageAspectRatio || settings.aspectRatio || '16:9',
        duration: 0,
        fps: 24,
        firstStrength: strength,
        imageMode: true,
        imageSteps: settings.imageSteps,
        projectName,
      })

      if (cancelledRef.current) return

      if (result.status === 'complete' && result.image_path) {
        const normalized = result.image_path.replace(/\\/g, '/')
        const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`

        setState({
          isGenerating: false,
          progress: 100,
          statusMessage: 'Complete!',
          videoUrl: null,
          videoPath: null,
          enhancedPrompt: null,
          imageUrl: fileUrl,
          imageUrls: [fileUrl],
          error: null,
          iterationCurrent: 0,
          iterationTotal: 0,
        })
      } else if (result.status === 'cancelled') {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          statusMessage: 'Cancelled',
        }))
      } else if (result.error) {
        throw new Error(result.error)
      }
    } catch (error) {
      if (cancelledRef.current) {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          statusMessage: 'Cancelled',
        }))
      } else {
        setState(prev => ({
          ...prev,
          isGenerating: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
      }
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
    }
  }, [])

  const reset = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  // --- Batch Queue ---

  const addToQueue = useCallback((params: QueueItemParams) => {
    const id = `queue-${nextQueueId++}-${Date.now()}`
    const item: QueueItem = {
      id,
      params,
      status: 'pending',
      progress: 0,
      statusMessage: 'Waiting...',
      videoUrl: null,
      videoPath: null,
      imageUrl: null,
      error: null,
      addedAt: Date.now(),
    }
    setQueue(prev => [...prev, item])
  }, [])

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => prev.filter(item => item.id !== id))
  }, [])

  const reorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    setQueue(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  const getCompletedResults = useCallback(() => {
    return queue
      .filter(item => item.status === 'complete')
      .map(item => ({
        path: item.videoPath || '',
        url: item.videoUrl || item.imageUrl || '',
        type: item.params.type,
        prompt: item.params.prompt,
      }))
      .filter(item => item.url !== '')
  }, [queue])

  const clearQueue = useCallback(() => {
    if (processingQueueRef.current) {
      queueCancelledRef.current = true
      cancelledRef.current = true
      window.electronAPI.cancelGeneration().catch(() => {})
    }
    setQueue([])
    setIsProcessingQueue(false)
    setQueuePosition(-1)
    processingQueueRef.current = false
  }, [])

  const cancelQueue = useCallback(() => {
    queueCancelledRef.current = true
    cancelledRef.current = true
    window.electronAPI.cancelGeneration().catch(() => {})
    setQueue(prev => prev.map(item =>
      item.status === 'pending' ? { ...item, status: 'cancelled' as const, statusMessage: 'Cancelled' } :
      item.status === 'generating' ? { ...item, status: 'cancelled' as const, statusMessage: 'Cancelled' } :
      item
    ))
    setIsProcessingQueue(false)
    setQueuePosition(-1)
    processingQueueRef.current = false
    setState(prev => ({
      ...prev,
      isGenerating: false,
      statusMessage: 'Queue cancelled',
    }))
  }, [])

  // Process queue items sequentially
  const processQueueItem = useCallback(async (item: QueueItem): Promise<void> => {
    const { params } = item
    cancelledRef.current = false
    let progressInterval: ReturnType<typeof setInterval> | null = null

    // Mark item as generating
    setQueue(prev => prev.map(q =>
      q.id === item.id ? { ...q, status: 'generating' as const, statusMessage: 'Generating...', progress: 0 } : q
    ))

    const isImage = params.type === 'image'
    const statusLabel = isImage ? 'image' : 'video'

    setState({
      isGenerating: true,
      progress: 0,
      statusMessage: `Generating ${statusLabel}...`,
      videoUrl: null,
      videoPath: null,
      enhancedPrompt: null,
      imageUrl: null,
      imageUrls: [],
      error: null,
      iterationCurrent: 0,
      iterationTotal: 0,
    })

    try {
      const pollProgress = async () => {
        if (cancelledRef.current || queueCancelledRef.current) return
        try {
          const data: GenerationProgress = await window.electronAPI.getGenerationProgress()
          if (cancelledRef.current || queueCancelledRef.current) return
          setState(prev => ({
            ...prev,
            progress: data.progress,
            statusMessage: getPhaseMessage(data.phase),
          }))
          setQueue(prev => prev.map(q =>
            q.id === item.id ? { ...q, progress: data.progress, statusMessage: getPhaseMessage(data.phase) } : q
          ))
        } catch {
          // Ignore polling errors
        }
      }

      progressInterval = setInterval(pollProgress, 500)

      let result: { status: string; video_path?: string; image_path?: string; enhanced_prompt?: string; error?: string }

      if (isImage) {
        const imageParams = {
          prompt: params.prompt,
          imagePath: params.imagePath,
          resolution: '1080p',
          aspectRatio: params.settings.imageAspectRatio || params.settings.aspectRatio || '16:9',
          duration: 0,
          fps: 24,
          firstStrength: params.imageStrength,
          imageMode: true,
          imageSteps: params.settings.imageSteps,
          projectName: params.projectName,
        }
        result = await window.electronAPI.generateVideo(imageParams)
      } else {
        const is4K = params.settings.videoResolution === '4K'
        const videoParams = {
          prompt: params.prompt,
          imagePath: params.imagePath,
          middleImagePath: params.middleImagePath,
          lastImagePath: params.lastImagePath,
          audioPath: params.audioPath,
          resolution: is4K ? '1080p' : params.settings.videoResolution,
          aspectRatio: params.settings.aspectRatio || '16:9',
          duration: params.settings.duration,
          fps: params.settings.fps,
          cameraMotion: params.settings.cameraMotion,
          spatialUpscale: params.settings.spatialUpscale,
          upscaleDenoise: params.settings.upscaleDenoise,
          temporalUpscale: params.settings.temporalUpscale,
          promptEnhance: params.settings.promptEnhance,
          filmGrain: params.settings.filmGrain,
          filmGrainIntensity: params.settings.filmGrainIntensity,
          filmGrainSize: params.settings.filmGrainSize,
          firstStrength: params.strengths?.first,
          middleStrength: params.strengths?.middle,
          lastStrength: params.strengths?.last,
          rtxSuperRes: is4K,
          preserveAspectRatio: params.preserveAspectRatio,
          projectName: params.projectName,
        }
        result = await window.electronAPI.generateVideo(videoParams)
      }

      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      if (cancelledRef.current || queueCancelledRef.current) {
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'cancelled' as const, statusMessage: 'Cancelled' } : q
        ))
        return
      }

      if (result.status === 'complete') {
        if (isImage && result.image_path) {
          const normalized = result.image_path.replace(/\\/g, '/')
          const fileUrl = normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
          setQueue(prev => prev.map(q =>
            q.id === item.id ? { ...q, status: 'complete' as const, progress: 100, statusMessage: 'Complete!', imageUrl: fileUrl } : q
          ))
          setState({
            isGenerating: false,
            progress: 100,
            statusMessage: 'Complete!',
            videoUrl: null,
            videoPath: null,
            enhancedPrompt: null,
            imageUrl: fileUrl,
            imageUrls: [fileUrl],
            error: null,
            iterationCurrent: 0,
            iterationTotal: 0,
          })
        } else if (result.video_path) {
          const videoPathNormalized = result.video_path.replace(/\\/g, '/')
          const fileUrl = videoPathNormalized.startsWith('/') ? `file://${videoPathNormalized}` : `file:///${videoPathNormalized}`
          setQueue(prev => prev.map(q =>
            q.id === item.id ? { ...q, status: 'complete' as const, progress: 100, statusMessage: 'Complete!', videoUrl: fileUrl, videoPath: result.video_path ?? null } : q
          ))
          setState({
            isGenerating: false,
            progress: 100,
            statusMessage: 'Complete!',
            videoUrl: fileUrl,
            videoPath: result.video_path,
            enhancedPrompt: result.enhanced_prompt ?? null,
            imageUrl: null,
            imageUrls: [],
            error: null,
            iterationCurrent: 0,
            iterationTotal: 0,
          })
        }
      } else if (result.status === 'cancelled') {
        setQueue(prev => prev.map(q =>
          q.id === item.id ? { ...q, status: 'cancelled' as const, statusMessage: 'Cancelled' } : q
        ))
      } else if (result.error) {
        throw new Error(result.error)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setQueue(prev => prev.map(q =>
        q.id === item.id ? { ...q, status: 'error' as const, statusMessage: errorMsg, error: errorMsg } : q
      ))
      setState(prev => ({
        ...prev,
        isGenerating: false,
        error: errorMsg,
      }))
    } finally {
      if (progressInterval) {
        clearInterval(progressInterval)
      }
    }
  }, [])

  // Auto-process queue when items are added
  useEffect(() => {
    if (processingQueueRef.current) return

    const pendingItems = queue.filter(q => q.status === 'pending')
    if (pendingItems.length === 0) return
    if (state.isGenerating) return

    const runQueue = async () => {
      processingQueueRef.current = true
      queueCancelledRef.current = false
      setIsProcessingQueue(true)

      // Snapshot pending IDs at start
      const pendingIds = queue.filter(q => q.status === 'pending').map(q => q.id)

      for (let i = 0; i < pendingIds.length; i++) {
        if (queueCancelledRef.current) break

        setQueuePosition(i)

        // Re-check the item is still pending (user may have removed it)
        const currentQueue = await new Promise<QueueItem[]>(resolve => {
          setQueue(prev => {
            resolve(prev)
            return prev
          })
        })
        const item = currentQueue.find(q => q.id === pendingIds[i] && q.status === 'pending')
        if (!item) continue

        await processQueueItem(item)

        // Brief pause between items
        if (!queueCancelledRef.current) {
          await new Promise(r => setTimeout(r, 200))
        }
      }

      setIsProcessingQueue(false)
      setQueuePosition(-1)
      processingQueueRef.current = false
      setState(prev => ({
        ...prev,
        isGenerating: false,
      }))
    }

    runQueue()
  }, [queue, state.isGenerating, processQueueItem])

  return (
    <GenerationContext.Provider value={{
      ...state,
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
      queuePosition,
      getCompletedResults,
    }}>
      {children}
    </GenerationContext.Provider>
  )
}

export function useGeneration(): GenerationContextType {
  const ctx = useContext(GenerationContext)
  if (!ctx) throw new Error('useGeneration must be used within GenerationProvider')
  return ctx
}
