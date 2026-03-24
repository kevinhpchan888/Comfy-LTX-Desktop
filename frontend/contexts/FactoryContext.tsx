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
  FrameSlot,
} from '../types/factory'
import { parseManifest, manifestToShots, getShotStats, parseDuration } from '../lib/factory-manifest'
import { saveFrame, saveVideo, organizeOutputs } from '../lib/factory-files'
// Performance log utilities (used when tracking is added)
// import { addPerfEntry, estimateApiCost } from '../lib/performance-log'
import { copyToAssetFolder } from '../lib/asset-copy'
import { DEFAULT_COLOR_CORRECTION } from '../types/project'
import type { Asset, TimelineClip, Track } from '../types/project'
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
  updateShotManifest: (id: string, updates: Partial<ManifestShot>) => void
  toggleShotEnabled: (id: string) => void

  // Multi-select & management
  selectedShotIds: Set<string>
  toggleShotSelection: (id: string) => void
  selectShotRange: (toId: string) => void
  selectAllShots: () => void
  deselectAllShots: () => void
  deleteShots: (ids: string[]) => void
  addNewShot: (shot: ManifestShot) => void
  reorderShots: (fromIndex: number, toIndex: number) => void
  renameScene: (oldName: string, newName: string) => void

  // Frame generation
  generateFrame: (shotId: string, slot?: FrameSlot) => Promise<void>
  generateAllFrames: () => Promise<void>
  uploadFrameImage: (shotId: string, filePath: string) => Promise<void>
  useWebImage: (shotId: string, imageUrl: string, attribution?: string) => Promise<void>
  requestRemotionFrame: (shotId: string, description: string) => void

  // Video rendering
  renderVideo: (shotId: string) => Promise<void>
  renderAllVideos: () => Promise<void>
  approveIteration: (shotId: string, iterationIndex: number) => void
  setActiveFrameIndex: (shotId: string, frameIndex: number) => void

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

  // Send to Editor
  sendToEditor: (shotIds: string[]) => Promise<void>
  sendToEditorAndExport: (shotIds: string[]) => Promise<void>

  // Auto-render
  autoRenderAll: boolean
  setAutoRenderAll: (v: boolean) => void
  toggleShotAutoRender: (id: string) => void

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

const FACTORY_STORAGE_KEY = 'ltx-factory-state'

interface FactoryPersisted {
  manifest: FactoryManifest | null
  shots: FactoryShot[]
  selectedShotId: string | null
}

function saveFactoryState(state: FactoryPersisted): void {
  try {
    localStorage.setItem(FACTORY_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function loadFactoryState(): FactoryPersisted | null {
  try {
    const raw = localStorage.getItem(FACTORY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as FactoryPersisted
    if (!parsed.manifest || !Array.isArray(parsed.shots)) return null
    return parsed
  } catch {
    return null
  }
}

function clearFactoryStorage(): void {
  localStorage.removeItem(FACTORY_STORAGE_KEY)
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const { addToQueue, queue } = useGeneration()
  const { currentProject, currentProjectId, addAsset, getActiveTimeline, updateTimeline, setCurrentTab } = useProjects()
  const { settings } = useAppSettings()

  // Restore persisted factory state on first load
  const restoredRef = useRef(false)
  const restored = !restoredRef.current ? loadFactoryState() : null
  if (!restoredRef.current) restoredRef.current = true

  // Manifest & shots
  const [manifest, setManifest] = useState<FactoryManifest | null>(restored?.manifest ?? null)
  const [shots, setShots] = useState<FactoryShot[]>(restored?.shots ?? [])
  // Refs for async loops to avoid stale closure reads
  const shotsRef = useRef(shots)
  shotsRef.current = shots
  const manifestRef = useRef(manifest)
  manifestRef.current = manifest
  const [selectedShotId, setSelectedShotId] = useState<string | null>(restored?.selectedShotId ?? null)
  const [selectedShotIds, setSelectedShotIds] = useState<Set<string>>(new Set())

  // Auto-save factory state (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      if (manifest) {
        saveFactoryState({ manifest, shots, selectedShotId })
      } else {
        clearFactoryStorage()
      }
    }, 1000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [manifest, shots, selectedShotId])

  // Write factory status file for MCP server integration (debounced)
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => {
      const projectPath = currentProject?.assetSavePath
      if (!projectPath || !manifest) return

      const errorShots = shots.filter(s => s.status === 'error' && s.error)
      const status = {
        timestamp: new Date().toISOString(),
        project: manifest.project.name,
        totalShots: shots.length,
        idle: shots.filter(s => s.status === 'idle').length,
        generatingFrame: shots.filter(s => s.status === 'generating-frame').length,
        frameReady: shots.filter(s => s.status === 'frame-ready').length,
        renderingVideo: shots.filter(s => s.status === 'rendering-video').length,
        videoReady: shots.filter(s => s.status === 'video-ready').length,
        approved: shots.filter(s => s.status === 'approved').length,
        errors: errorShots.map(s => ({
          shotId: s.manifest.id,
          scene: s.manifest.scene,
          error: s.error,
          prompt: s.manifest.video.prompt.slice(0, 200),
        })),
      }

      const statusPath = `${projectPath}/factory/.factory-status.json`
      void window.electronAPI.ensureDirectory(`${projectPath}/factory`).then(() => {
        void window.electronAPI.saveFile(statusPath, JSON.stringify(status, null, 2))
      })
    }, 2000)
    return () => { if (statusTimerRef.current) clearTimeout(statusTimerRef.current) }
  }, [shots, manifest, currentProject])

  // Pipeline state
  const [phase, setPhase] = useState<FactoryPhase>('idle')
  const [progress, setProgress] = useState<FactoryProgress>(INITIAL_PROGRESS)
  const cancelledRef = useRef(false)

  // GPU
  const [gpuInfo, setGpuInfo] = useState<GpuCapabilities | null>(null)
  const [gpuWarnings, setGpuWarnings] = useState<ValidationWarning[]>([])

  // Auto-render after frame generation
  const [autoRenderAll, setAutoRenderAll] = useState(false)

  // Creative Console
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [isChatStreaming, setIsChatStreaming] = useState(false)

  // Track queue items mapped to shots
  const shotQueueMapRef = useRef<Map<string, string>>(new Map())
  const prevQueueRef = useRef<QueueItem[]>([])

  // Detect GPU on restored factory state
  useEffect(() => {
    if (restored?.manifest && restored.shots.length > 0) {
      void detectGpuCapabilities().then(info => {
        setGpuInfo(info)
        setGpuWarnings(validateAllShotsGpu(restored.shots, info.vramGb))
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setSelectedShotIds(new Set())
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
    setSelectedShotIds(new Set())
    setPhase('idle')
    setProgress(INITIAL_PROGRESS)
    setChatMessages([])
    setGpuWarnings([])
    clearFactoryStorage()
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

  const toggleShotAutoRender = useCallback((id: string) => {
    setShots(prev => prev.map(s =>
      s.manifest.id === id ? { ...s, autoRenderVideo: !s.autoRenderVideo } : s
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

  const updateShotManifest = useCallback((id: string, updates: Partial<ManifestShot>) => {
    setShots(prev => prev.map(s =>
      s.manifest.id === id ? { ...s, manifest: { ...s.manifest, ...updates } } : s
    ))
    setManifest(prev => {
      if (!prev) return prev
      return {
        ...prev,
        shots: prev.shots.map(s => s.id === id ? { ...s, ...updates } : s),
      }
    })
  }, [])

  // ─── Multi-select & Management ────────────────────────────────────────────

  const toggleShotSelection = useCallback((id: string) => {
    setSelectedShotIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectShotRange = useCallback((toId: string) => {
    if (!selectedShotId) {
      setSelectedShotIds(new Set([toId]))
      return
    }
    const fromIdx = shots.findIndex(s => s.manifest.id === selectedShotId)
    const toIdx = shots.findIndex(s => s.manifest.id === toId)
    if (fromIdx === -1 || toIdx === -1) return
    const start = Math.min(fromIdx, toIdx)
    const end = Math.max(fromIdx, toIdx)
    const ids = shots.slice(start, end + 1).map(s => s.manifest.id)
    setSelectedShotIds(new Set(ids))
  }, [shots, selectedShotId])

  const selectAllShots = useCallback(() => {
    setSelectedShotIds(new Set(shots.map(s => s.manifest.id)))
  }, [shots])

  const deselectAllShots = useCallback(() => {
    setSelectedShotIds(new Set())
  }, [])

  const deleteShots = useCallback((ids: string[]) => {
    const idSet = new Set(ids)
    setShots(prev => prev.filter(s => !idSet.has(s.manifest.id)))
    setManifest(prev => {
      if (!prev) return prev
      return { ...prev, shots: prev.shots.filter(s => !idSet.has(s.id)) }
    })
    // Clear selection for deleted shots
    setSelectedShotIds(prev => {
      const next = new Set(prev)
      for (const id of ids) next.delete(id)
      return next
    })
    // If the active shot was deleted, clear it
    if (selectedShotId && idSet.has(selectedShotId)) {
      setSelectedShotId(null)
    }
  }, [selectedShotId])

  const addNewShot = useCallback((shotData: ManifestShot) => {
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
    setSelectedShotId(shotData.id)
  }, [])

  const reorderShots = useCallback((fromIndex: number, toIndex: number) => {
    setShots(prev => {
      const updated = [...prev]
      const [moved] = updated.splice(fromIndex, 1)
      updated.splice(toIndex, 0, moved)
      // Reassign order values to match new positions
      return updated.map((s, i) => ({
        ...s,
        manifest: { ...s.manifest, order: i + 1 },
      }))
    })
    setManifest(prev => {
      if (!prev) return prev
      // Sync manifest shot order with the new shots order
      return prev // Will be kept in sync via shots state
    })
  }, [])

  const renameScene = useCallback((oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) return
    const trimmed = newName.trim()
    setShots(prev => prev.map(s =>
      s.manifest.scene === oldName
        ? { ...s, manifest: { ...s.manifest, scene: trimmed, scene_slug: trimmed.toLowerCase().replace(/\s+/g, '_') } }
        : s
    ))
  }, [])

  // ─── Frame Generation ────────────────────────────────────────────────────

  const generateFrame = useCallback(async (shotId: string, slot: FrameSlot = 'first') => {
    const shot = shotsRef.current.find(s => s.manifest.id === shotId)
    if (!shot || !manifestRef.current) return

    setShots(prev => prev.map(s =>
      s.manifest.id === shotId ? { ...s, status: 'generating-frame', error: undefined } : s
    ))

    // Select prompt based on slot
    const frameConfig = shot.manifest.frames[slot]
    let imagePrompt: string
    if (frameConfig && frameConfig.source === 'generate' && frameConfig.prompt) {
      imagePrompt = frameConfig.prompt
    } else if (slot === 'first') {
      imagePrompt = shot.manifest.video.prompt
    } else if (slot === 'middle') {
      imagePrompt = `Mid-point of: ${shot.manifest.video.prompt.slice(0, 500)}`
    } else {
      imagePrompt = `Final moment of: ${shot.manifest.video.prompt.slice(0, 500)}`
    }

    if (!imagePrompt) {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId
          ? { ...s, status: 'error', error: 'No prompt available for image generation' }
          : s
      ))
      return
    }

    try {
      // Wrap IPC call with a safety timeout (default 30 minutes for image gen)
      const genPromise = window.electronAPI.generateVideo({
        imageMode: true,
        prompt: imagePrompt,
        resolution: '1080p',
        aspectRatio: shot.manifest.video.aspect_ratio || '16:9',
        duration: 0,
        fps: 24,
        projectName: manifestRef.current.project.name,
      })
      const timeoutMs = settings.factoryRenderTimeout || 1800000 // default 30 min
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Image generation timed out after ${Math.round(timeoutMs / 60000)} minutes`)), timeoutMs)
      )
      const result = await Promise.race([genPromise, timeoutPromise])

      if (result.status === 'complete' && result.image_path) {
        const projectPath = getProjectPath()
        const slotIterations = shot.frameSlots?.[slot]?.iterations || (slot === 'first' ? shot.frameIterations : [])
        const iterationNum = slotIterations.length + 1

        let savedPath = result.image_path
        let savedUrl = result.image_path.replace(/\\/g, '/')
        savedUrl = savedUrl.startsWith('/') ? `file://${savedUrl}` : `file:///${savedUrl}`

        if (projectPath) {
          const saved = await saveFrame(shotId, result.image_path, projectPath, slot, iterationNum)
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

          // Update the specific slot
          const currentSlots = s.frameSlots || {
            first: { iterations: [...s.frameIterations], activeIndex: s.activeFrameIndex },
            middle: { iterations: [], activeIndex: -1 },
            last: { iterations: [], activeIndex: -1 },
          }
          const slotData = currentSlots[slot]
          const newIterations = [...slotData.iterations, iteration]

          const updatedSlots = {
            ...currentSlots,
            [slot]: { iterations: newIterations, activeIndex: newIterations.length - 1 },
          }

          // Also update legacy fields for backward compat (first slot)
          const legacyFrameIterations = slot === 'first' ? newIterations : s.frameIterations
          const legacyActiveFrameIndex = slot === 'first' ? newIterations.length - 1 : s.activeFrameIndex

          return {
            ...s,
            status: 'frame-ready',
            frameIterations: legacyFrameIterations,
            activeFrameIndex: legacyActiveFrameIndex,
            frameSlots: updatedSlots,
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
  }, [getProjectPath, settings.factoryRenderTimeout])

  const generateAllFrames = useCallback(async () => {
    cancelledRef.current = false
    const currentShots = shotsRef.current
    const enabledShots = currentShots.filter(s => s.status !== 'disabled' && s.manifest.enabled)
    // Include all shots that haven't generated a frame yet (idle or error)
    const shotsNeedingFrames = enabledShots.filter(s =>
      s.frameIterations.length === 0 && (s.status === 'idle' || s.status === 'error')
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
  }, [generateFrame])

  // ─── Upload / Web Image ────────────────────────────────────────────────────

  /** Upload a local image file as the frame for a shot. */
  const uploadFrameImage = useCallback(async (shotId: string, filePath: string) => {
    const projectPath = getProjectPath()
    if (!projectPath) return

    try {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId ? { ...s, status: 'generating-frame', error: undefined } : s
      ))

      const currentShot = shotsRef.current.find(s => s.manifest.id === shotId)
      const iterNum = (currentShot?.frameIterations.length || 0) + 1
      const saved = await saveFrame(shotId, filePath, projectPath, 'first', iterNum)

      const iteration: ShotIteration = {
        id: crypto.randomUUID(),
        path: saved.path,
        url: saved.url,
        createdAt: Date.now(),
      }

      setShots(prev => prev.map(s => {
        if (s.manifest.id !== shotId) return s
        const newIterations = [...s.frameIterations, iteration]
        return {
          ...s,
          status: 'frame-ready',
          frameIterations: newIterations,
          activeFrameIndex: newIterations.length - 1,
          error: undefined,
        }
      }))
    } catch (err) {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId
          ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Upload failed' }
          : s
      ))
    }
  }, [getProjectPath])

  /** Download a web image and use it as the frame for a shot. */
  const useWebImage = useCallback(async (shotId: string, imageUrl: string, attribution?: string) => {
    const projectPath = getProjectPath()
    if (!projectPath) return

    try {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId ? { ...s, status: 'generating-frame', error: undefined } : s
      ))

      // Download the image to a temp path first
      const ext = imageUrl.match(/\.(png|jpg|jpeg|webp|gif|bmp)/i)?.[1] || 'jpg'
      const currentShot = shotsRef.current.find(s => s.manifest.id === shotId)
      const iterNum = (currentShot?.frameIterations.length || 0) + 1
      const dir = `${projectPath}/factory/${shotId}`
      await window.electronAPI.ensureDirectory(dir)
      const destPath = `${dir}/${shotId}_web_v${iterNum}.${ext}`

      const result = await window.electronAPI.downloadUrl(imageUrl, destPath)
      if (!result.success) {
        throw new Error(result.error || 'Download failed')
      }

      const normalizedPath = result.path || destPath
      const url = normalizedPath.startsWith('/') ? `file://${normalizedPath}` : `file:///${normalizedPath.replace(/\\/g, '/')}`

      const iteration: ShotIteration = {
        id: crypto.randomUUID(),
        path: normalizedPath,
        url,
        createdAt: Date.now(),
      }

      setShots(prev => prev.map(s => {
        if (s.manifest.id !== shotId) return s
        const newIterations = [...s.frameIterations, iteration]
        return {
          ...s,
          status: 'frame-ready',
          frameIterations: newIterations,
          activeFrameIndex: newIterations.length - 1,
          error: undefined,
        }
      }))

      if (attribution) {
        console.log(`[Factory] Image for ${shotId}: ${attribution}`)
      }
    } catch (err) {
      setShots(prev => prev.map(s =>
        s.manifest.id === shotId
          ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Image download failed' }
          : s
      ))
    }
  }, [getProjectPath])

  /** Write a Remotion motion graphic request for Claude Code to pick up via MCP. */
  const requestRemotionFrame = useCallback((shotId: string, description: string) => {
    const projectPath = currentProject?.assetSavePath
    if (!projectPath) return

    const requestsPath = `${projectPath}/factory/.remotion-requests.json`
    const request = {
      shotId,
      description,
      timestamp: new Date().toISOString(),
      status: 'pending' as const,
      scene: shotsRef.current.find(s => s.manifest.id === shotId)?.manifest.scene || '',
    }

    // Read existing requests, append, write back
    void (async () => {
      try {
        await window.electronAPI.ensureDirectory(`${projectPath}/factory`)
        let existing: typeof request[] = []
        try {
          const raw = await fetch(`file://${requestsPath.replace(/\\/g, '/')}`)
          if (raw.ok) existing = await raw.json() as typeof request[]
        } catch {
          // File doesn't exist yet
        }
        // Replace existing request for same shot or append
        const idx = existing.findIndex(r => r.shotId === shotId)
        if (idx >= 0) {
          existing[idx] = request
        } else {
          existing.push(request)
        }
        await window.electronAPI.saveFile(requestsPath, JSON.stringify(existing, null, 2))
      } catch (err) {
        console.error('[Factory] Failed to write Remotion request:', err)
      }
    })()
  }, [currentProject])

  // ─── Video Rendering ─────────────────────────────────────────────────────

  const renderVideo = useCallback(async (shotId: string) => {
    const shot = shotsRef.current.find(s => s.manifest.id === shotId)
    const currentManifest = manifestRef.current
    if (!shot || !currentManifest) return

    // Resolve frames for each slot: first, middle, last
    const getSlotPath = (s: FactoryShot, slotName: 'first' | 'middle' | 'last'): string | null => {
      const slotData = s.frameSlots?.[slotName]
      if (slotData && slotData.iterations.length > 0 && slotData.activeIndex >= 0) {
        return slotData.iterations[slotData.activeIndex].path
      }
      // Backward compat: legacy frameIterations = first slot
      if (slotName === 'first' && s.frameIterations.length > 0 && s.activeFrameIndex >= 0) {
        return s.frameIterations[s.activeFrameIndex].path
      }
      return null
    }

    const firstFramePath = getSlotPath(shot, 'first')
    const middleFramePath = getSlotPath(shot, 'middle')
    const lastFramePath = getSlotPath(shot, 'last')

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
      // Pass first frame as main image, middle/last as additional conditioning
      imagePath: firstFramePath,
      middleImagePath: middleFramePath,
      lastImagePath: lastFramePath,
      projectName: currentManifest.project.name,
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
  }, [addToQueue, settings])

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
    const currentShots = shotsRef.current
    const enabledShots = currentShots.filter(s =>
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
  }, [renderVideo, settings.factoryDelayBetweenShots])

  // Auto-render: when a shot transitions to frame-ready, auto-trigger video render
  const prevShotStatusesRef = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    const prevStatuses = prevShotStatusesRef.current
    for (const shot of shots) {
      const prevStatus = prevStatuses.get(shot.manifest.id)
      if (
        prevStatus !== 'frame-ready' &&
        shot.status === 'frame-ready' &&
        (autoRenderAll || shot.autoRenderVideo)
      ) {
        void renderVideo(shot.manifest.id)
      }
    }
    // Update prev statuses
    const next = new Map<string, string>()
    for (const shot of shots) next.set(shot.manifest.id, shot.status)
    prevShotStatusesRef.current = next
  }, [shots, autoRenderAll, renderVideo])

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

  const setActiveFrameIndex = useCallback((shotId: string, frameIndex: number) => {
    setShots(prev => prev.map(s => {
      if (s.manifest.id !== shotId) return s
      if (frameIndex < 0 || frameIndex >= s.frameIterations.length) return s
      return { ...s, activeFrameIndex: frameIndex }
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
    const result = await organizeOutputs(shotsRef.current, projectPath)
    setPhase('complete')
    return result
  }, [getProjectPath])

  // ─── Send to Editor ─────────────────────────────────────────────────────

  /** Shared helper: copy shots to asset folder, create assets + timeline clips, switch to editor.
   *  Sends rendered videos when available, falls back to frame images.
   *  Returns the new clips and tracks (for optional auto-export). */
  const sendShotsToTimeline = useCallback(async (shotIds: string[]): Promise<{ clips: TimelineClip[]; tracks: Track[] } | null> => {
    if (!currentProjectId || !currentProject) return null

    // Include shots that have either rendered videos OR generated frames
    const shotsToSend = shotsRef.current.filter(s =>
      shotIds.includes(s.manifest.id) && (s.videoIterations.length > 0 || s.frameIterations.length > 0)
    )
    if (shotsToSend.length === 0) {
      console.warn('[Factory] No shots with videos or frames to send to editor')
      return null
    }

    const assetSavePath = currentProject.assetSavePath || undefined
    const newAssets: Asset[] = []

    for (const shot of shotsToSend) {
      // Prefer rendered video, fall back to frame image
      const activeVideo = shot.videoIterations[shot.activeVideoIndex]
      const activeFrame = shot.frameIterations[shot.activeFrameIndex]

      if (activeVideo) {
        const { path: finalPath, url: finalUrl } = await copyToAssetFolder(
          activeVideo.path, activeVideo.url, assetSavePath,
        )
        const asset = addAsset(currentProjectId, {
          type: 'video',
          path: finalPath,
          url: finalUrl,
          prompt: shot.manifest.video.prompt,
          resolution: shot.manifest.video.resolution || '',
          duration: parseDuration(shot.manifest.video.duration),
        })
        newAssets.push(asset)
      } else if (activeFrame) {
        const { path: finalPath, url: finalUrl } = await copyToAssetFolder(
          activeFrame.path, activeFrame.url, assetSavePath,
        )
        const asset = addAsset(currentProjectId, {
          type: 'image',
          path: finalPath,
          url: finalUrl,
          prompt: shot.manifest.video.prompt,
          resolution: shot.manifest.video.resolution || '',
          duration: parseDuration(shot.manifest.video.duration),
        })
        newAssets.push(asset)
      }
    }

    if (newAssets.length === 0) return null

    const timeline = getActiveTimeline(currentProjectId)
    if (!timeline) return null

    const videoTrackIndex = timeline.tracks.findIndex(t => t.kind === 'video' && !t.locked)
    const targetTrack = videoTrackIndex >= 0 ? videoTrackIndex : 0

    const trackClips = timeline.clips.filter(c => c.trackIndex === targetTrack)
    let nextStart = trackClips.reduce((max, clip) =>
      Math.max(max, clip.startTime + clip.duration), 0,
    )

    const newClips: TimelineClip[] = newAssets.map(asset => {
      const clipDuration = asset.duration || 5
      const clip: TimelineClip = {
        id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        assetId: asset.id,
        type: 'video',
        startTime: nextStart,
        duration: clipDuration,
        trimStart: 0,
        trimEnd: 0,
        speed: 1,
        reversed: false,
        muted: false,
        volume: 1,
        trackIndex: targetTrack,
        asset,
        flipH: false,
        flipV: false,
        transitionIn: { type: 'none', duration: 0 },
        transitionOut: { type: 'none', duration: 0 },
        colorCorrection: DEFAULT_COLOR_CORRECTION,
        opacity: 100,
      }
      nextStart += clipDuration
      return clip
    })

    const allClips = [...timeline.clips, ...newClips]
    updateTimeline(currentProjectId, timeline.id, { clips: allClips })
    setCurrentTab('video-editor')

    return { clips: allClips, tracks: timeline.tracks }
  }, [currentProjectId, currentProject, addAsset, getActiveTimeline, updateTimeline, setCurrentTab])

  const sendToEditor = useCallback(async (shotIds: string[]) => {
    await sendShotsToTimeline(shotIds)
  }, [sendShotsToTimeline])

  const sendToEditorAndExport = useCallback(async (shotIds: string[]) => {
    const result = await sendShotsToTimeline(shotIds)
    if (!result) return

    // Determine export dimensions from the first shot's resolution
    const firstShot = shotsRef.current.find(s => shotIds.includes(s.manifest.id) && s.videoIterations.length > 0)
    const resStr = firstShot?.manifest.video.resolution || '720p'
    const resDims: Record<string, [number, number]> = {
      '4K': [3840, 2160], '2160p': [3840, 2160],
      '1440p': [2560, 1440],
      '1080p': [1920, 1080],
      '720p': [1280, 720],
      '540p': [960, 540],
    }
    const [exportWidth, exportHeight] = resDims[resStr] || resDims['720p']
    const fps = firstShot?.manifest.video.fps || 24

    const projectName = currentProject?.name || 'factory-export'
    const filePath = await window.electronAPI?.showSaveDialog({
      title: 'Export Stitched Video',
      defaultPath: `${projectName}_stitched.mp4`,
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (!filePath) return

    const exportClips = result.clips
      .filter(c => c.type === 'video' || c.type === 'image' || c.type === 'audio')
      .filter(c => result.tracks[c.trackIndex]?.enabled !== false)
      .map(c => ({
        url: c.asset?.url || c.importedUrl || '',
        type: c.type as string,
        startTime: c.startTime,
        duration: c.duration,
        trimStart: c.trimStart,
        speed: c.speed || 1,
        reversed: c.reversed || false,
        flipH: c.flipH || false,
        flipV: c.flipV || false,
        opacity: c.opacity ?? 100,
        trackIndex: c.trackIndex,
        muted: c.muted || false,
        volume: c.volume ?? 1,
      }))

    await window.electronAPI?.exportNative({
      clips: exportClips,
      outputPath: filePath,
      codec: 'h264',
      width: exportWidth,
      height: exportHeight,
      fps,
      quality: 20,
    })
  }, [sendShotsToTimeline, currentProject])

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
      if (llmSettings.aiProvider === 'claude-max' && !llmSettings.proxyUrl) {
        throw new Error('Claude Max proxy URL not configured. Open Settings → AI Provider to set your proxy URL.')
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
    updateShotManifest,
    toggleShotEnabled,
    selectedShotIds,
    toggleShotSelection,
    selectShotRange,
    selectAllShots,
    deselectAllShots,
    deleteShots,
    addNewShot,
    reorderShots,
    renameScene,
    generateFrame,
    generateAllFrames,
    uploadFrameImage,
    useWebImage,
    requestRemotionFrame,
    renderVideo,
    renderAllVideos,
    approveIteration,
    setActiveFrameIndex,
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
    sendToEditor,
    sendToEditorAndExport,
    autoRenderAll,
    setAutoRenderAll,
    toggleShotAutoRender,
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
