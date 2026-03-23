import type { FactoryShot } from '../types/factory'

/** Get the root factory output directory for a project. */
export function getFactoryDir(projectPath: string): string {
  return `${projectPath}/factory`
}

/** Get the directory for a specific shot's outputs. */
export function getShotDir(projectPath: string, shotId: string): string {
  return `${projectPath}/factory/${shotId}`
}

/** Normalize a file path to a file:// URL. */
function pathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`
}

/** Save a generated frame to the factory output directory. Returns the saved path and URL. */
export async function saveFrame(
  shotId: string,
  sourcePath: string,
  projectPath: string,
  slot: 'first' | 'middle' | 'last' = 'first',
  iteration: number = 1,
): Promise<{ path: string; url: string }> {
  const dir = getShotDir(projectPath, shotId)
  await window.electronAPI.ensureDirectory(dir)

  const ext = sourcePath.split('.').pop() || 'png'
  const filename = `${shotId}_${slot}_v${iteration}.${ext}`
  const destPath = `${dir}/${filename}`

  await window.electronAPI.copyFile(sourcePath, destPath)
  return { path: destPath, url: pathToFileUrl(destPath) }
}

/** Save a rendered video to the factory output directory. Returns the saved path and URL. */
export async function saveVideo(
  shotId: string,
  sourcePath: string,
  projectPath: string,
  iteration: number = 1,
): Promise<{ path: string; url: string }> {
  const dir = getShotDir(projectPath, shotId)
  await window.electronAPI.ensureDirectory(dir)

  const ext = sourcePath.split('.').pop() || 'mp4'
  const filename = `${shotId}_v${iteration}.${ext}`
  const destPath = `${dir}/${filename}`

  await window.electronAPI.copyFile(sourcePath, destPath)
  return { path: destPath, url: pathToFileUrl(destPath) }
}

/** Organize approved outputs into a structured directory. */
export async function organizeOutputs(
  shots: FactoryShot[],
  projectPath: string,
): Promise<{ organized: number; errors: string[] }> {
  const outputDir = `${projectPath}/factory/output`
  await window.electronAPI.ensureDirectory(outputDir)

  let organized = 0
  const errors: string[] = []

  for (const shot of shots) {
    if (shot.status !== 'approved' && shot.status !== 'video-ready') continue

    const activeVideo = shot.videoIterations[shot.activeVideoIndex]
    if (!activeVideo) continue

    try {
      // Create scene folder
      const sceneSlug = shot.manifest.scene_slug || shot.manifest.scene.toLowerCase().replace(/\s+/g, '_')
      const sceneDir = `${outputDir}/${sceneSlug}`
      await window.electronAPI.ensureDirectory(sceneDir)

      // Copy video
      const ext = activeVideo.path.split('.').pop() || 'mp4'
      const videoFilename = `${shot.manifest.id}_v${shot.activeVideoIndex + 1}.${ext}`
      await window.electronAPI.copyFile(activeVideo.path, `${sceneDir}/${videoFilename}`)

      // Copy active frame if exists
      const activeFrame = shot.frameIterations[shot.activeFrameIndex]
      if (activeFrame) {
        const frameDir = `${outputDir}/frames`
        await window.electronAPI.ensureDirectory(frameDir)
        const frameExt = activeFrame.path.split('.').pop() || 'png'
        await window.electronAPI.copyFile(activeFrame.path, `${frameDir}/${shot.manifest.id}_frame.${frameExt}`)
      }

      organized++
    } catch (e) {
      errors.push(`${shot.manifest.id}: ${e instanceof Error ? e.message : 'copy failed'}`)
    }
  }

  // Generate render log
  try {
    const log = generateRenderLog(shots)
    const logPath = `${outputDir}/render_log.json`
    await window.electronAPI.saveFile(logPath, JSON.stringify(log, null, 2))
  } catch {
    errors.push('Failed to write render_log.json')
  }

  return { organized, errors }
}

/** Generate a render log with statistics. */
function generateRenderLog(shots: FactoryShot[]) {
  const enabled = shots.filter(s => s.status !== 'disabled')
  return {
    generated_at: new Date().toISOString(),
    stats: {
      total_shots: shots.length,
      enabled: enabled.length,
      rendered: enabled.filter(s => s.videoIterations.length > 0).length,
      approved: enabled.filter(s => s.status === 'approved').length,
      errors: enabled.filter(s => s.status === 'error').length,
    },
    shots: shots.map(s => ({
      id: s.manifest.id,
      scene: s.manifest.scene,
      status: s.status,
      error: s.error || null,
      frames: s.frameIterations.length,
      videos: s.videoIterations.length,
      activeVideo: s.activeVideoIndex >= 0 ? s.videoIterations[s.activeVideoIndex]?.path || null : null,
    })),
  }
}
