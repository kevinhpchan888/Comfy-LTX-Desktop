import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type {
  FactoryManifest,
  FactoryShot,
  FactoryPhase,
  FactoryProgress,
  ChatMessage,
  ShotIteration,
  GpuCapabilities,
  ShotPreview,
  ManifestShot,
  ValidationWarning,
} from '../types/factory'
import { parseManifest, manifestToShots, getShotStats, parseDuration } from '../lib/factory-manifest'
import { saveFrame, saveVideo, organizeOutputs } from '../lib/factory-files'
import { detectGpuCapabilities, validateAllShotsGpu } from '../lib/factory-gpu'
import { createLLMService } from '../lib/llm-service'
import type { LLMMessage } from '../lib/llm-service'
import { useGeneration } from './GenerationContext'
import type { QueueItem } from './GenerationContext'
import { useProjects } from './ProjectContext'
import { useAppSettings } from './AppSettingsContext'
import type { GenerationSettings } from '../components/SettingsPanel'

// ─── Context Interface ───────────────────────────────────────────────────────

interface FactoryContextType {
  // Manifest
  manifest: FactoryManifest | null
  importManifest: (json: string) => { success: boolean; errors: string[] }
  clearFactory: () => void

  // Shots
  shots: FactoryShot[]
  selectedShotId: string | null
  selectShot: (id: string | null) => void
  updateShot: (id: string, updates: Partial<FactoryShot>) => void
  toggleShotEnabled: (id: string) => void

  // Frame generation
  generateFrame: (shotId: string) => Promise<void>
  generateAllFrames: () => Promise<void>

  // Video rendering
  renderVideo: (shotId: string) => Promise<void>
  renderAllVideos: () => Promise<void>
  approveIteration: (shotId: string, iterationIndex: number) => void

  // Pipeline
  phase: FactoryPhase
  progress: FactoryProgress
  cancelPipeline: () => void
  organizeOutput: () => Promise<{ organized: number; errors: string[] }>

  // GPU
  gpuInfo: GpuCapabilities | null
  refreshGpuInfo: () => Promise<void>
  gpuWarnings: ValidationWarning[]

  // Creative Console
  chatMessages: ChatMessage[]
  sendChatMessage: (content: string) => Promise<void>
  applyShotPreview: (messageId: string, previewIndex: number) => void
  isChatStreaming: boolean

  // Stats
  stats: ReturnType<typeof getShotStats>
}

const FactoryContext = createContext<FactoryContextType | null>(null)

// ─── Initial Values ──────────────────────────────────────────────────────────

const INITIAL_PROGRESS: FactoryProgress = {
  completed: 0,
  total: 0,
  currentShotId: null,
  startTime: null,
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const { addToQueue, queue } = useGeneration()
  const { currentProject } = useProjects()
  const { settings } = useAppSettings()

  // Manifest & shots
  const [manifest, setManifest] = useState<FactoryManifest | null>(null)
  const [shots, setShots] = useState<FactoryShot[]>([])
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null)

  // Pipeline state
  const [phase, setPhase] = useState<FactoryPhase>('idle')
  const [progress, setProgress] = useState<FactoryProgress>(INITIAL_PROGRESS)
  const cancelledRef = useRef(false)

  // GPU
  const [gpuInfo, setGpuInfo] = useState<GpuCapabilities | null>(null)
  const [gpuWarnings, setGpuWarnings] = useState<ValidationWarning[]>([])

  // Creative Console
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isChatStreaming, setIsChatStreaming] = useState(false)

  // Track queue items mapped to shots
  const shotQueueMapRef = useRef<Map<string, string>>(new Map())
  const prevQueueRef = useRef<QueueItem[]>([])

  // ─── Helpers ─────────────────────────────────────────────────────────────

  const getProjectPath = useCallback((): string => {
    return currentProject?.assetSavePath || ''
  }, [currentProject])

  // ─── Manifest ────────────────────────────────────────────────────────────

  const importManifest = useCallback((json: string): { success: boolean; errors: string[] } => {
    const result = parseManifest(json)
    if (!result.manifest) {
      return { success: false, errors: result.errors }
    }

    const newShots = manifestToShots(result.manifest)
    setManifest(result.manifest)
    setShots(newShots)
    setSelectedShotId(newShots.length > 0 ? newShots[0].manifest.id : null)
    setPhase('idle')
    setProgress(INITIAL_PROGRESS)
    setChatMessages([])
    shotQueueMapRef.current.clear()

    // Detect GPU on import
    void detectGpuCapabilities().then(info => {
      setGpuInfo(info)
      setGpuWarnings(validateAllShotsGpu(newShots, info.vramGb))
    })

    return { success: result.errors.length === 0, errors: result.errors }
  }, [])

  const clearFactory = useCallback(() => {
    setManifest(null)
    setShots([])
    setSelectedShotId(null)
    setPhase('idle')
    setProgress(INITIAL_PROGRESS)
    setChatMessages([])
    setGpuWarnings([])
    cancelledRef.current = false
    shotQueueMapRef.current.clear()
  }, [])

  // ─── Shots ───────────────────────────────────────────────────────────────

  const selectShot = useCallback((id: string | null) => {
    setSelectedShotId(id)
  }, [])

  const updateShot = useCallback((id: string, updates: Partial<FactoryShot>) => {
    setShots(prev => prev.map(s =>
      s.manifest.id === id ? { ...s, ...updates } : s
    ))
  }, [])

  const toggleShotEnabled = useCallback((id: string) => {
    setShots(prev => prev.map(s => {
      if (s.manifest.id !== id) return s
      const newEnabled = !s.manifest.enabled
      return {
        ...s,
        manifest: { ...s.manifest, enabled: newEnabled },
        status: newEnabled ? 'idle' : 'disabled',
      }
    }))
  }, [])

  // ─── Frame Generation ────────────────────────────────────────────────────

  const generateFrame = useCallback(async (shotId: string) => {
    const shot = shots.find(s => s.manifest.id === shotId)
    if (!shot || !manifest) return

    setShots(prev => prev.map(s =>
      s.manifest.id === shotId ? { ...s, status: 'generating-frame', error: undefined } : s
    ))

    const frameConfig = shot.manifest.frames.first
    if (!frameConfig || frameConfig.source !== 'generate') {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId
          ? { ...s, status: 'error', error: 'No generatable frame config found' }
          : s
      ))
      return
    }

    try {
      const result = await window.electronAPI.generateVideo({
        imageMode: true,
        prompt: frameConfig.prompt,
        resolution: '1080p',
        aspectRatio: shot.manifest.video.aspect_ratio || '16:9',
        duration: 0,
        fps: 24,
        projectName: manifest.project.name,
      })

      if (result.status === 'complete' && result.image_path) {
        const projectPath = getProjectPath()
        const iterationNum = shot.frameIterations.length + 1

        let savedPath = result.image_path
        let savedUrl = result.image_path.replace(/\\/g, '/')
        savedUrl = savedUrl.startsWith('/') ? `file://${savedUrl}` : `file:///${savedUrl}`

        if (projectPath) {
          const saved = await saveFrame(shotId, result.image_path, projectPath, 'first', iterationNum)
          savedPath = saved.path
          savedUrl = saved.url
        }

        const iteration: ShotIteration = {
          id: crypto.randomUUID(),
          path: savedPath,
          url: savedUrl,
          createdAt: Date.now(),
        }

        setShots(prev => prev.map(s => {
          if (s.manifest.id !== shotId) return s
          const newFrameIterations = [...s.frameIterations, iteration]
          return {
            ...s,
            status: 'frame-ready',
            frameIterations: newFrameIterations,
            activeFrameIndex: newFrameIterations.length - 1,
            error: undefined,
          }
        }))
      } else if (result.error) {
        setShots(prev => prev.map(s =>
          s.manifest.id === shotId ? { ...s, status: 'error', error: result.error } : s
        ))
      }
    } catch (err) {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId
          ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Frame generation failed' }
          : s
      ))
    }
  }, [shots, manifest, getProjectPath])

  const generateAllFrames = useCallback(async () => {
    cancelledRef.current = false
    const enabledShots = shots.filter(s => s.status !== 'disabled' && s.manifest.enabled)
    const shotsNeedingFrames = enabledShots.filter(s =>
      s.manifest.frames.first && s.manifest.frames.first.source === 'generate' && s.frameIterations.length === 0
    )

    if (shotsNeedingFrames.length === 0) return

    setPhase('generating-frames')
    setProgress({ completed: 0, total: shotsNeedingFrames.length, currentShotId: null, startTime: Date.now() })

    for (let i = 0; i < shotsNeedingFrames.length; i++) {
      if (cancelledRef.current) break

      const shot = shotsNeedingFrames[i]
      setProgress(prev => ({ ...prev, completed: i, currentShotId: shot.manifest.id }))

      await generateFrame(shot.manifest.id)
    }

    setProgress(prev => ({ ...prev, completed: shotsNeedingFrames.length, currentShotId: null }))
    setPhase(cancelledRef.current ? 'idle' : 'reviewing')
  }, [shots, generateFrame])

  // ─── Video Rendering ─────────────────────────────────────────────────────

  const renderVideo = useCallback(async (shotId: string) => {
    const shot = shots.find(s => s.manifest.id === shotId)
    if (!shot || !manifest) return

    const activeFrame = shot.frameIterations[shot.activeFrameIndex]

    const duration = parseDuration(shot.manifest.video.duration)
    const genSettings: GenerationSettings = {
      model: 'pro',
      duration,
      videoResolution: shot.manifest.video.resolution || settings.factoryDefaultResolution,
      fps: shot.manifest.video.fps || settings.factoryDefaultFps,
      audio: shot.manifest.video.audio,
      cameraMotion: shot.manifest.video.camera_motion || '',
      aspectRatio: shot.manifest.video.aspect_ratio || settings.factoryDefaultAspectRatio,
      filmGrain: shot.manifest.video.film_grain,
      spatialUpscale: shot.manifest.video.spatial_upscale,
      temporalUpscale: shot.manifest.video.temporal_upscale,
      promptEnhance: shot.manifest.video.prompt_enhance,
      imageResolution: '1080p',
      imageAspectRatio: shot.manifest.video.aspect_ratio || '16:9',
      imageSteps: 20,
    }

    // Track this shot for queue matching
    const matchKey = `factory-${shotId}-${Date.now()}`

    addToQueue({
      type: 'video',
      prompt: shot.manifest.video.prompt,
      settings: genSettings,
      imagePath: activeFrame?.path ?? null,
      projectName: manifest.project.name,
    })

    setShots(prev => prev.map(s =>
      s.manifest.id === shotId
        ? { ...s, status: 'rendering-video', queueItemId: matchKey, error: undefined }
        : s
    ))

    // We need to find the newly added queue item by watching for it.
    // Store mapping so the queue watcher effect can match it.
    // Since addToQueue doesn't return an ID, we watch for the next queue item to appear.
    // Use a timeout to let state propagate, then capture the new item ID.
    await new Promise<void>(resolve => {
      const checkInterval = setInterval(() => {
        // Queue state is async — we rely on the effect to handle matching
        clearInterval(checkInterval)
        resolve()
      }, 100)
    })
  }, [shots, manifest, queue, addToQueue, settings])

  // Effect to capture newly added queue item IDs for factory shots
  useEffect(() => {
    const prevQueue = prevQueueRef.current
    const prevIds = new Set(prevQueue.map(q => q.id))

    // Find newly added items
    const newItems = queue.filter(q => !prevIds.has(q.id))

    // If there are factory shots waiting for queue IDs, assign them
    if (newItems.length > 0) {
      setShots(prev => {
        const waitingShots = prev.filter(s => s.status === 'rendering-video' && s.queueItemId?.startsWith('factory-'))
        if (waitingShots.length === 0) return prev

        let newItemIdx = 0
        return prev.map(s => {
          if (s.status === 'rendering-video' && s.queueItemId?.startsWith('factory-') && newItemIdx < newItems.length) {
            const assignedItem = newItems[newItemIdx]
            newItemIdx++
            shotQueueMapRef.current.set(assignedItem.id, s.manifest.id)
            return { ...s, queueItemId: assignedItem.id }
          }
          return s
        })
      })
    }

    // Check for completed queue items that belong to factory shots
    for (const item of queue) {
      const prevItem = prevQueue.find(q => q.id === item.id)
      if (!prevItem) continue

      // Detect transition to complete
      if (prevItem.status !== 'complete' && item.status === 'complete') {
        const factoryShotId = shotQueueMapRef.current.get(item.id)
        if (!factoryShotId) continue

        const videoPath = item.videoPath
        if (!videoPath) continue

        // Save video and update shot
        const projectPath = currentProject?.assetSavePath || ''
        void (async () => {
          try {
            let savedPath = videoPath
            let savedUrl = item.videoUrl || ''

            if (projectPath) {
              // Count existing iterations from current shots state
              const currentShot = shots.find(s => s.manifest.id === factoryShotId)
              const iterNum = (currentShot?.videoIterations.length || 0) + 1
              const saved = await saveVideo(factoryShotId, videoPath, projectPath, iterNum)
              savedPath = saved.path
              savedUrl = saved.url
            }

            const iteration: ShotIteration = {
              id: crypto.randomUUID(),
              path: savedPath,
              url: savedUrl,
              createdAt: Date.now(),
            }

            setShots(prev => prev.map(s => {
              if (s.manifest.id !== factoryShotId) return s
              const newVideoIterations = [...s.videoIterations, iteration]
              return {
                ...s,
                status: 'video-ready',
                videoIterations: newVideoIterations,
                activeVideoIndex: newVideoIterations.length - 1,
                queueItemId: undefined,
                error: undefined,
              }
            }))
          } catch (err) {
            setShots(prev => prev.map(s =>
              s.manifest.id === factoryShotId
                ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Save failed', queueItemId: undefined }
                : s
            ))
          } finally {
            shotQueueMapRef.current.delete(item.id)
          }
        })()
      }

      // Detect transition to error
      if (prevItem.status !== 'error' && item.status === 'error') {
        const factoryShotId = shotQueueMapRef.current.get(item.id)
        if (!factoryShotId) continue

        setShots(prev => prev.map(s =>
          s.manifest.id === factoryShotId
            ? { ...s, status: 'error', error: item.error || 'Render failed', queueItemId: undefined }
            : s
        ))
        shotQueueMapRef.current.delete(item.id)
      }
    }

    prevQueueRef.current = queue
  }, [queue, shots, currentProject])

  const renderAllVideos = useCallback(async () => {
    cancelledRef.current = false
    const enabledShots = shots.filter(s =>
      s.status === 'frame-ready' && s.manifest.enabled
    )

    if (enabledShots.length === 0) return

    setPhase('rendering')
    setProgress({ completed: 0, total: enabledShots.length, currentShotId: null, startTime: Date.now() })

    for (let i = 0; i < enabledShots.length; i++) {
      if (cancelledRef.current) break

      const shot = enabledShots[i]
      setProgress(prev => ({ ...prev, completed: i, currentShotId: shot.manifest.id }))

      await renderVideo(shot.manifest.id)

      // Delay between shots
      if (settings.factoryDelayBetweenShots > 0 && i < enabledShots.length - 1 && !cancelledRef.current) {
        await new Promise(r => setTimeout(r, settings.factoryDelayBetweenShots))
      }
    }

    setProgress(prev => ({ ...prev, completed: enabledShots.length, currentShotId: null }))
    setPhase(cancelledRef.current ? 'reviewing' : 'complete')
  }, [shots, renderVideo, settings.factoryDelayBetweenShots])

  const approveIteration = useCallback((shotId: string, iterationIndex: number) => {
    setShots(prev => prev.map(s => {
      if (s.manifest.id !== shotId) return s
      return {
        ...s,
        activeVideoIndex: iterationIndex,
        status: 'approved',
      }
    }))
  }, [])

  // ─── Pipeline ────────────────────────────────────────────────────────────

  const cancelPipeline = useCallback(() => {
    cancelledRef.current = true
    setPhase('idle')
    setProgress(INITIAL_PROGRESS)
  }, [])

  const organizeOutput = useCallback(async (): Promise<{ organized: number; errors: string[] }> => {
    const projectPath = getProjectPath()
    if (!projectPath) {
      return { organized: 0, errors: ['No project path configured'] }
    }

    setPhase('organizing')
    const result = await organizeOutputs(shots, projectPath)
    setPhase('complete')
    return result
  }, [shots, getProjectPath])

  // ─── GPU ─────────────────────────────────────────────────────────────────

  const refreshGpuInfo = useCallback(async () => {
    const info = await detectGpuCapabilities()
    setGpuInfo(info)
    setGpuWarnings(validateAllShotsGpu(shots, info.vramGb))
  }, [shots])

  // ─── Creative Console ────────────────────────────────────────────────────

  const sendChatMessage = useCallback(async (content: string) => {
    if (!manifest) return

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }

    setChatMessages(prev => [...prev, userMessage])
    setIsChatStreaming(true)

    const assistantMessageId = crypto.randomUUID()
    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      shotPreviews: [],
    }

    setChatMessages(prev => [...prev, assistantMessage])

    try {
      const llmSettings = {
        aiProvider: settings.factoryAiProvider,
        anthropicApiKey: settings.factoryAnthropicApiKey,
        anthropicModel: settings.factoryAnthropicModel,
        proxyUrl: settings.factoryProxyUrl,
        proxyToken: settings.factoryProxyToken,
        proxyModel: settings.factoryProxyModel,
      }

      // Validate configuration before attempting LLM call
      if (llmSettings.aiProvider === 'anthropic' && !llmSettings.anthropicApiKey) {
        throw new Error('Anthropic API key not configured. Open Settings → AI Provider to add your key.')
      }
      if (llmSettings.aiProvider === 'local' && !llmSettings.proxyUrl) {
        throw new Error('Proxy URL not configured. Open Settings → AI Provider to set your local proxy.')
      }
      if (llmSettings.aiProvider === 'hybrid' && !llmSettings.anthropicApiKey && !llmSettings.proxyUrl) {
        throw new Error('No AI provider configured. Open Settings → AI Provider to set up Anthropic or a local proxy.')
      }

      const llm = createLLMService(llmSettings)

      const selectedShot = shots.find(s => s.manifest.id === selectedShotId)
      const shotStats = getShotStats(shots)

      const systemPrompt = `You are the creative director AI for an LTX Shot Factory project.
PROJECT: ${manifest.project.name}
SHOTS: ${shots.length} | RENDERED: ${shotStats.rendered} | APPROVED: ${shotStats.approved}
Currently selected shot: ${selectedShot ? JSON.stringify(selectedShot.manifest, null, 2) : 'none'}

When modifying or creating shots, output the complete shot JSON object wrapped in \`\`\`json code blocks.
The user can click [Apply] to insert your shot into the manifest.

MANIFEST:
${JSON.stringify(manifest, null, 2)}`

      // Build message history for context
      const historyMessages: LLMMessage[] = chatMessages
        .filter(m => m.id !== assistantMessageId)
        .map(m => ({ role: m.role, content: m.content }))
      historyMessages.push({ role: 'user', content })

      let fullContent = ''

      for await (const token of llm.stream({
        system: systemPrompt,
        messages: historyMessages,
        maxTokens: 4096,
        temperature: 0.7,
      })) {
        fullContent += token
        setChatMessages(prev => prev.map(m =>
          m.id === assistantMessageId ? { ...m, content: fullContent } : m
        ))
      }

      // Parse shot previews from JSON code blocks
      const shotPreviews: ShotPreview[] = []
      const jsonBlockRegex = /```json\s*([\s\S]*?)```/g
      let match = jsonBlockRegex.exec(fullContent)
      while (match) {
        try {
          const parsed = JSON.parse(match[1]) as ManifestShot
          if (parsed.id && parsed.video) {
            const existingShot = shots.find(s => s.manifest.id === parsed.id)
            shotPreviews.push({
              shot: parsed,
              action: existingShot ? 'update' : 'add',
              applied: false,
            })
          }
        } catch {
          // Skip unparseable blocks
        }
        match = jsonBlockRegex.exec(fullContent)
      }

      if (shotPreviews.length > 0) {
        setChatMessages(prev => prev.map(m =>
          m.id === assistantMessageId ? { ...m, content: fullContent, shotPreviews } : m
        ))
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Chat request failed'
      setChatMessages(prev => prev.map(m =>
        m.id === assistantMessageId
          ? { ...m, content: `Error: ${errorText}` }
          : m
      ))
    } finally {
      setIsChatStreaming(false)
    }
  }, [manifest, shots, selectedShotId, chatMessages, settings])

  const applyShotPreview = useCallback((messageId: string, previewIndex: number) => {
    const message = chatMessages.find(m => m.id === messageId)
    if (!message?.shotPreviews) return

    const preview = message.shotPreviews[previewIndex]
    if (!preview || preview.applied) return

    const shotData = preview.shot

    if (preview.action === 'update') {
      // Update existing shot manifest
      setShots(prev => prev.map(s =>
        s.manifest.id === shotData.id ? { ...s, manifest: shotData } : s
      ))
      // Also update in manifest
      setManifest(prev => {
        if (!prev) return prev
        return {
          ...prev,
          shots: prev.shots.map(s => s.id === shotData.id ? shotData : s),
        }
      })
    } else if (preview.action === 'add') {
      // Add new shot
      const newFactoryShot: FactoryShot = {
        manifest: shotData,
        status: shotData.enabled === false ? 'disabled' : 'idle',
        frameIterations: [],
        activeFrameIndex: -1,
        videoIterations: [],
        activeVideoIndex: -1,
      }
      setShots(prev => {
        const updated = [...prev, newFactoryShot]
        updated.sort((a, b) => a.manifest.order - b.manifest.order)
        return updated
      })
      setManifest(prev => {
        if (!prev) return prev
        return { ...prev, shots: [...prev.shots, shotData] }
      })
    }

    // Mark preview as applied
    setChatMessages(prev => prev.map(m => {
      if (m.id !== messageId || !m.shotPreviews) return m
      return {
        ...m,
        shotPreviews: m.shotPreviews.map((sp, idx) =>
          idx === previewIndex ? { ...sp, applied: true } : sp
        ),
      }
    }))
  }, [chatMessages])

  // ─── Stats ───────────────────────────────────────────────────────────────

  const stats = getShotStats(shots)

  // ─── Context Value ───────────────────────────────────────────────────────

  const contextValue: FactoryContextType = {
    manifest,
    importManifest,
    clearFactory,
    shots,
    selectedShotId,
    selectShot,
    updateShot,
    toggleShotEnabled,
    generateFrame,
    generateAllFrames,
    renderVideo,
    renderAllVideos,
    approveIteration,
    phase,
    progress,
    cancelPipeline,
    organizeOutput,
    gpuInfo,
    refreshGpuInfo,
    gpuWarnings,
    chatMessages,
    sendChatMessage,
    applyShotPreview,
    isChatStreaming,
    stats,
  }

  return (
    <FactoryContext.Provider value={contextValue}>
      {children}
    </FactoryContext.Provider>
  )
}

export function useFactory(): FactoryContextType {
  const ctx = useContext(FactoryContext)
  if (!ctx) throw new Error('useFactory must be used within FactoryProvider')
  return ctx
}
