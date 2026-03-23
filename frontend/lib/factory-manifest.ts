import type { FactoryManifest, FactoryShot, ManifestShot, FrameSlot, ShotIteration } from '../types/factory'

/** Parse and validate a JSON manifest string. Returns the manifest and any validation errors. */
export function parseManifest(json: string): { manifest: FactoryManifest | null; errors: string[] } {
  const errors: string[] = []

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (e) {
    return { manifest: null, errors: [`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`] }
  }

  if (!raw || typeof raw !== 'object') {
    return { manifest: null, errors: ['Manifest must be a JSON object'] }
  }

  const obj = raw as Record<string, unknown>

  // Version check
  if (!obj.manifest_version || typeof obj.manifest_version !== 'string') {
    errors.push('Missing or invalid "manifest_version" field')
  }

  // Project info
  if (!obj.project || typeof obj.project !== 'object') {
    errors.push('Missing "project" field')
  }

  // Shots array
  if (!Array.isArray(obj.shots)) {
    return { manifest: null, errors: [...errors, '"shots" must be an array'] }
  }

  if (obj.shots.length === 0) {
    errors.push('"shots" array is empty')
  }

  const seenIds = new Set<string>()
  const seenOrders = new Set<number>()
  const shotIds = new Set<string>()

  // Pre-collect all shot IDs for reference checking
  for (const s of obj.shots) {
    if (s && typeof s === 'object' && 'id' in s) {
      shotIds.add(String((s as Record<string, unknown>).id))
    }
  }

  // Validate each shot
  for (let i = 0; i < obj.shots.length; i++) {
    const shot = obj.shots[i] as Record<string, unknown> | null
    const prefix = `Shot[${i}]`

    if (!shot || typeof shot !== 'object') {
      errors.push(`${prefix}: must be an object`)
      continue
    }

    // Required fields
    if (!shot.id || typeof shot.id !== 'string') {
      errors.push(`${prefix}: missing or invalid "id"`)
    } else {
      if (seenIds.has(shot.id)) {
        errors.push(`${prefix}: duplicate ID "${shot.id}"`)
      }
      seenIds.add(shot.id)
    }

    if (!shot.scene || typeof shot.scene !== 'string') {
      errors.push(`${prefix} (${shot.id || '?'}): missing "scene"`)
    }

    if (typeof shot.order !== 'number') {
      errors.push(`${prefix} (${shot.id || '?'}): missing or invalid "order"`)
    } else {
      if (seenOrders.has(shot.order)) {
        errors.push(`${prefix} (${shot.id || '?'}): duplicate order value ${shot.order}`)
      }
      seenOrders.add(shot.order)
    }

    // Video config
    const video = shot.video as Record<string, unknown> | undefined
    if (!video || typeof video !== 'object') {
      errors.push(`${prefix} (${shot.id || '?'}): missing "video" configuration`)
    } else {
      if (!video.prompt || typeof video.prompt !== 'string') {
        errors.push(`${prefix} (${shot.id || '?'}): missing video prompt`)
      } else if (video.prompt.length > 5000) {
        errors.push(`${prefix} (${shot.id || '?'}): video prompt exceeds 5000 chars (${video.prompt.length})`)
      }

      if (!video.duration) {
        errors.push(`${prefix} (${shot.id || '?'}): missing video duration`)
      }
    }

    // Check previous_shot references in frames
    const frames = shot.frames as Record<string, unknown> | undefined
    if (frames && typeof frames === 'object') {
      for (const slot of ['first', 'middle', 'last'] as const) {
        const frameConf = frames[slot] as Record<string, unknown> | null
        if (frameConf && frameConf.source === 'previous_shot') {
          const refId = String(frameConf.shot_id || '')
          if (!shotIds.has(refId)) {
            errors.push(`${prefix} (${shot.id || '?'}): frames.${slot} references non-existent shot "${refId}"`)
          }
          // Check that referenced shot has lower order
          const refShot = obj.shots.find(
            (s: unknown) => s && typeof s === 'object' && (s as Record<string, unknown>).id === refId,
          ) as Record<string, unknown> | undefined
          if (refShot && typeof refShot.order === 'number' && typeof shot.order === 'number') {
            if (refShot.order >= shot.order) {
              errors.push(
                `${prefix} (${shot.id || '?'}): frames.${slot} references shot "${refId}" with order ${refShot.order} >= ${shot.order}`,
              )
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    // Still return the manifest if it's structurally valid enough to display
    if (Array.isArray(obj.shots) && obj.shots.length > 0) {
      return { manifest: obj as unknown as FactoryManifest, errors }
    }
    return { manifest: null, errors }
  }

  return { manifest: obj as unknown as FactoryManifest, errors: [] }
}

/** Convert manifest shots to runtime FactoryShot objects, sorted by order. */
const EMPTY_SLOT = { iterations: [] as ShotIteration[], activeIndex: -1 }

export function manifestToShots(manifest: FactoryManifest): FactoryShot[] {
  const sorted = [...manifest.shots].sort((a, b) => a.order - b.order)
  return sorted.map(shot => ({
    manifest: shot,
    status: shot.enabled === false ? 'disabled' : 'idle',
    frameIterations: [],
    activeFrameIndex: -1,
    frameSlots: {
      first: { ...EMPTY_SLOT, iterations: [] },
      middle: { ...EMPTY_SLOT, iterations: [] },
      last: { ...EMPTY_SLOT, iterations: [] },
    },
    videoIterations: [],
    activeVideoIndex: -1,
  }))
}

/** Get the active frame iteration for a given slot. Falls back to legacy frameIterations for 'first'. */
export function getSlotFrame(shot: FactoryShot, slot: FrameSlot): ShotIteration | undefined {
  const slotData = shot.frameSlots?.[slot]
  if (slotData && slotData.iterations.length > 0 && slotData.activeIndex >= 0) {
    return slotData.iterations[slotData.activeIndex]
  }
  // Backward compat: legacy frameIterations = first slot
  if (slot === 'first' && shot.frameIterations.length > 0 && shot.activeFrameIndex >= 0) {
    return shot.frameIterations[shot.activeFrameIndex]
  }
  return undefined
}

/** Group shots by scene for display in the storyboard. */
export function groupShotsByScene(shots: FactoryShot[]): Map<string, FactoryShot[]> {
  const groups = new Map<string, FactoryShot[]>()
  for (const shot of shots) {
    const scene = shot.manifest.scene
    const existing = groups.get(scene) || []
    existing.push(shot)
    groups.set(scene, existing)
  }
  return groups
}

/** Calculate summary stats for a set of shots. */
export function getShotStats(shots: FactoryShot[]) {
  const enabled = shots.filter(s => s.status !== 'disabled')
  return {
    total: shots.length,
    enabled: enabled.length,
    idle: enabled.filter(s => s.status === 'idle').length,
    framesReady: enabled.filter(s => s.status === 'frame-ready' || s.status === 'rendering-video' || s.status === 'video-ready' || s.status === 'approved').length,
    rendered: enabled.filter(s => s.status === 'video-ready' || s.status === 'approved').length,
    approved: enabled.filter(s => s.status === 'approved').length,
    errors: enabled.filter(s => s.status === 'error').length,
    totalDuration: enabled.reduce((sum, s) => sum + (parseDuration(s.manifest.video.duration) || 0), 0),
  }
}

/** Parse a duration string like "5 sec" to seconds. */
export function parseDuration(duration: string | number): number {
  if (typeof duration === 'number') return duration
  const match = duration.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : 5
}

/** Validate a single shot's manifest data and return warnings. */
export function validateShot(shot: ManifestShot): string[] {
  const warnings: string[] = []

  if (shot.video.prompt.length > 5000) {
    warnings.push('Prompt exceeds 5000 characters')
  }

  const cfg = shot.pipeline_overrides?.sampler?.cfg_scale
  if (cfg !== undefined && cfg > 7.0) {
    warnings.push(`CFG ${cfg} > 7.0 may cause robotic motion`)
  }

  if (shot.extend?.enabled) {
    const targetDur = shot.extend.target_duration_seconds
    const originalDur = parseDuration(shot.video.duration)
    if (targetDur <= originalDur) {
      warnings.push(`Extend target ${targetDur}s <= original ${originalDur}s`)
    }
  }

  return warnings
}
