import type {
  CheckpointVariant,
  FactoryShot,
  GpuCapabilities,
  PipelinePreset,
  ValidationWarning,
  VramEstimate,
} from '../types/factory'

// ─── VRAM Estimation Table ──────────────────────────────────────────────────

const VRAM_ESTIMATES: Record<CheckpointVariant, VramEstimate> = {
  'dev':            { checkpoint: 42, generation: 32 },
  'dev-fp8':        { checkpoint: 24, generation: 20 },
  'distilled':      { checkpoint: 42, generation: 32 },
  'distilled-fp8':  { checkpoint: 24, generation: 16 },
  'gguf-q8':        { checkpoint: 25, generation: 12 },
  'gguf-q4':        { checkpoint: 18, generation: 8 },
}

// Resolution multipliers (higher res = more VRAM)
const RESOLUTION_VRAM_OVERHEAD: Record<string, number> = {
  '540p': 0.85,
  '720p': 1.0,
  '1080p': 1.35,
  '4K': 2.0,
}

// ─── Pipeline Presets ───────────────────────────────────────────────────────

export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    id: 'quality',
    label: 'Quality (Default)',
    checkpoint: 'dev-fp8',
    steps: 20,
    cfg: 3.0,
    speedLora: false,
    sampler: 'euler',
    minVram: 20,
    description: 'Best quality for final renders',
  },
  {
    id: 'fast-draft',
    label: 'Fast Draft',
    checkpoint: 'dev-fp8',
    steps: 8,
    cfg: 1.0,
    speedLora: true,
    sampler: 'euler',
    minVram: 20,
    description: 'Quick iteration with speed LoRA',
  },
  {
    id: 'maximum-quality',
    label: 'Maximum Quality',
    checkpoint: 'dev',
    steps: 30,
    cfg: 3.5,
    speedLora: false,
    sampler: 'euler',
    minVram: 32,
    description: 'Full precision for hero shots',
  },
  {
    id: 'organic-motion',
    label: 'Organic Motion',
    checkpoint: 'dev-fp8',
    steps: 20,
    cfg: 4.0,
    speedLora: false,
    sampler: 'euler_ancestral',
    minVram: 20,
    description: 'Nature, wind, water scenes',
  },
  {
    id: 'low-vram',
    label: 'Low VRAM',
    checkpoint: 'gguf-q4',
    steps: 15,
    cfg: 3.0,
    speedLora: false,
    sampler: 'euler',
    minVram: 8,
    description: 'For 8-12GB GPUs',
  },
  {
    id: 'speed-priority',
    label: 'Speed Priority',
    checkpoint: 'distilled-fp8',
    steps: 8,
    cfg: 1.0,
    speedLora: false,
    sampler: 'euler',
    minVram: 16,
    description: 'Fastest possible generation',
  },
]

// ─── GPU Detection ──────────────────────────────────────────────────────────

/** Detect GPU capabilities from both Electron and backend. */
export async function detectGpuCapabilities(): Promise<GpuCapabilities> {
  try {
    // Try Electron GPU check first
    const electronGpu = await window.electronAPI.checkGpu()

    // Try backend for more detailed info
    let backendInfo: { name?: string; vram?: number; cuda_available?: boolean } = {}
    try {
      const response = await fetch('http://localhost:8000/api/gpu-info')
      if (response.ok) {
        const data = await response.json()
        backendInfo = {
          name: data.gpu_name || data.gpu_info?.name,
          vram: data.vram_gb || (data.gpu_info?.vram ? Math.floor(data.gpu_info.vram / 1024) : undefined),
          cuda_available: data.cuda_available,
        }
      }
    } catch {
      // Backend not available
    }

    return {
      available: electronGpu.available || backendInfo.cuda_available || false,
      name: backendInfo.name || electronGpu.name || 'Unknown',
      vramGb: backendInfo.vram || electronGpu.vram || 0,
      cudaAvailable: backendInfo.cuda_available ?? electronGpu.available,
    }
  } catch {
    return { available: false, name: 'Unknown', vramGb: 0, cudaAvailable: false }
  }
}

// ─── VRAM Estimation ────────────────────────────────────────────────────────

/** Estimate VRAM needed for a given checkpoint + resolution + upscale combo. */
export function estimateVramNeeded(
  checkpoint: CheckpointVariant,
  resolution: string = '720p',
  withUpscale: boolean = false,
): number {
  const base = VRAM_ESTIMATES[checkpoint]
  if (!base) return 24 // safe fallback

  const resMultiplier = RESOLUTION_VRAM_OVERHEAD[resolution] || 1.0
  let vram = base.generation * resMultiplier

  if (withUpscale) {
    vram += 4 // upscaler overhead
  }

  return Math.ceil(vram)
}

/** Get checkpoint variant from a checkpoint string or model name. */
export function resolveCheckpoint(model: string): CheckpointVariant {
  const lower = model.toLowerCase()
  if (lower.includes('gguf') && lower.includes('q4')) return 'gguf-q4'
  if (lower.includes('gguf') && lower.includes('q8')) return 'gguf-q8'
  if (lower.includes('distilled') && lower.includes('fp8')) return 'distilled-fp8'
  if (lower.includes('distilled')) return 'distilled'
  if (lower.includes('fp8') || lower.includes('dev-fp8')) return 'dev-fp8'
  if (lower.includes('dev')) return 'dev'
  return 'dev-fp8' // safe default
}

// ─── Preset Selection ───────────────────────────────────────────────────────

/** Get presets compatible with the detected VRAM. */
export function getCompatiblePresets(vramGb: number): PipelinePreset[] {
  return PIPELINE_PRESETS.filter(p => p.minVram <= vramGb)
}

/** Auto-select the best quality preset that fits available VRAM. */
export function getRecommendedPreset(vramGb: number): PipelinePreset {
  const compatible = getCompatiblePresets(vramGb)
  if (compatible.length === 0) return PIPELINE_PRESETS[4] // low-vram fallback

  // Prefer quality > organic > fast-draft > speed > maximum (sorted by practical preference)
  const preference = ['quality', 'organic-motion', 'fast-draft', 'speed-priority', 'maximum-quality', 'low-vram']
  for (const id of preference) {
    const found = compatible.find(p => p.id === id)
    if (found) return found
  }
  return compatible[0]
}

// ─── Shot Validation ────────────────────────────────────────────────────────

/** Validate a single shot's settings against GPU capabilities. */
export function validateShotGpu(shot: FactoryShot, vramGb: number): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  const id = shot.manifest.id

  // Check pipeline overrides
  const overrides = shot.manifest.pipeline_overrides

  // CFG check
  const cfg = overrides?.sampler?.cfg_scale
  if (cfg !== undefined && cfg > 7.0) {
    warnings.push({ shotId: id, severity: 'warning', message: `CFG ${cfg} > 7.0 causes robotic motion in LTX 2.3` })
  }

  // VRAM estimation
  const resolution = shot.manifest.video.resolution || '720p'
  const withUpscale = shot.manifest.video.spatial_upscale
  // Use project default checkpoint since manifest doesn't specify variant directly
  const vramNeeded = estimateVramNeeded('dev-fp8', resolution, withUpscale)
  if (vramNeeded > vramGb) {
    warnings.push({
      shotId: id,
      severity: 'warning',
      message: `Estimated ${vramNeeded}GB VRAM needed, only ${vramGb}GB available`,
    })
  }

  // LoRA validation
  const loras = overrides?.loras
  if (loras) {
    const enabledCameraLoras = [loras.camera].filter(l => l?.enabled)
    if (enabledCameraLoras.length > 1) {
      warnings.push({ shotId: id, severity: 'error', message: 'Multiple camera LoRAs not supported' })
    }
  }

  return warnings
}

/** Validate all shots and return aggregated warnings. */
export function validateAllShotsGpu(shots: FactoryShot[], vramGb: number): ValidationWarning[] {
  return shots.flatMap(shot => validateShotGpu(shot, vramGb))
}

/** Enforced checkpoint rules: returns locked settings for a checkpoint. */
export function getCheckpointRules(checkpoint: CheckpointVariant): { lockedSteps?: number; lockedCfg?: number } {
  switch (checkpoint) {
    case 'dev':
    case 'dev-fp8':
      return { lockedSteps: 20, lockedCfg: 3.0 }
    case 'distilled':
    case 'distilled-fp8':
      return { lockedSteps: 8, lockedCfg: 1.0 }
    default:
      return {}
  }
}
