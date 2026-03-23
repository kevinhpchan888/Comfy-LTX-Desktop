// ─── Performance Log Types ──────────────────────────────────────────────────

export interface GenerationLogEntry {
  id: string
  shotId: string
  type: 'image' | 'video'
  engine: 'local' | 'api'
  status: 'success' | 'error' | 'timeout' | 'cancelled'
  startTime: number
  endTime: number
  durationMs: number
  // Generation params
  resolution: string
  aspectRatio: string
  videoDuration: number
  fps: number
  model: string
  // Cost tracking (API only)
  estimatedCost?: number
  // Error info
  error?: string
}

export interface PerformanceStats {
  totalGenerations: number
  successCount: number
  errorCount: number
  totalTimeMs: number
  avgTimeMs: number
  // Engine breakdown
  localCount: number
  localTotalMs: number
  localAvgMs: number
  apiCount: number
  apiTotalMs: number
  apiAvgMs: number
  // Cost
  totalEstimatedCost: number
  // By type
  imageCount: number
  videoCount: number
  imageAvgMs: number
  videoAvgMs: number
}

const PERF_LOG_KEY = 'ltx-factory-perf-log'
const MAX_ENTRIES = 500

// ─── Storage ────────────────────────────────────────────────────────────────

export function loadPerfLog(): GenerationLogEntry[] {
  try {
    const raw = localStorage.getItem(PERF_LOG_KEY)
    if (!raw) return []
    return JSON.parse(raw) as GenerationLogEntry[]
  } catch {
    return []
  }
}

export function savePerfLog(entries: GenerationLogEntry[]): void {
  try {
    // Keep only the most recent entries
    const trimmed = entries.slice(-MAX_ENTRIES)
    localStorage.setItem(PERF_LOG_KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage full
  }
}

export function addPerfEntry(entry: GenerationLogEntry): void {
  const entries = loadPerfLog()
  entries.push(entry)
  savePerfLog(entries)
}

export function clearPerfLog(): void {
  localStorage.removeItem(PERF_LOG_KEY)
}

// ─── Stats Calculation ──────────────────────────────────────────────────────

export function calculateStats(entries: GenerationLogEntry[]): PerformanceStats {
  const successful = entries.filter(e => e.status === 'success')

  const localEntries = successful.filter(e => e.engine === 'local')
  const apiEntries = successful.filter(e => e.engine === 'api')
  const imageEntries = successful.filter(e => e.type === 'image')
  const videoEntries = successful.filter(e => e.type === 'video')

  const sum = (arr: GenerationLogEntry[]) => arr.reduce((s, e) => s + e.durationMs, 0)
  const avg = (arr: GenerationLogEntry[]) => arr.length > 0 ? Math.round(sum(arr) / arr.length) : 0

  return {
    totalGenerations: entries.length,
    successCount: successful.length,
    errorCount: entries.filter(e => e.status !== 'success').length,
    totalTimeMs: sum(successful),
    avgTimeMs: avg(successful),

    localCount: localEntries.length,
    localTotalMs: sum(localEntries),
    localAvgMs: avg(localEntries),

    apiCount: apiEntries.length,
    apiTotalMs: sum(apiEntries),
    apiAvgMs: avg(apiEntries),

    totalEstimatedCost: entries.reduce((s, e) => s + (e.estimatedCost || 0), 0),

    imageCount: imageEntries.length,
    videoCount: videoEntries.length,
    imageAvgMs: avg(imageEntries),
    videoAvgMs: avg(videoEntries),
  }
}

// ─── Cost Estimation ────────────────────────────────────────────────────────

/** Rough cost estimate for LTX API calls (placeholder rates). */
export function estimateApiCost(type: 'image' | 'video', resolution: string, durationSec: number): number {
  // Placeholder pricing — adjust when actual API pricing is known
  if (type === 'image') {
    return resolution === '1080p' ? 0.02 : 0.01
  }
  // Video: base cost + per-second
  const baseCost = resolution === '1080p' ? 0.10 : resolution === '720p' ? 0.06 : 0.03
  const perSecond = resolution === '1080p' ? 0.02 : resolution === '720p' ? 0.01 : 0.005
  return baseCost + (perSecond * durationSec)
}

// ─── Time Formatting ────────────────────────────────────────────────────────

export function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const secs = ms / 1000
  if (secs < 60) return `${secs.toFixed(1)}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = Math.round(secs % 60)
  return `${mins}m ${remainSecs}s`
}

export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00'
  if (cost < 0.01) return '<$0.01'
  return `$${cost.toFixed(2)}`
}
