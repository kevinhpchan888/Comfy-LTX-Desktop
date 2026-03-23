import { spawn, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { logger } from '../logger'

let comfyProcess: ChildProcess | null = null

/**
 * Find the Python executable inside a ComfyUI installation.
 * Checks venv paths and embedded Python (Windows portable).
 */
function findComfyPython(comfyPath: string): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(comfyPath, 'venv', 'Scripts', 'python.exe'),
          path.join(comfyPath, '.venv', 'Scripts', 'python.exe'),
          path.join(comfyPath, 'python_embeded', 'python.exe'),
        ]
      : [
          path.join(comfyPath, 'venv', 'bin', 'python'),
          path.join(comfyPath, '.venv', 'bin', 'python'),
        ]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

/**
 * Launch ComfyUI as a child process.
 * Returns true if the process was started, false otherwise.
 */
export function launchComfyUI(comfyPath: string): boolean {
  if (comfyProcess && !comfyProcess.killed) {
    logger.info('[comfyui-launcher] ComfyUI process already running')
    return true
  }

  if (!comfyPath || !fs.existsSync(comfyPath)) {
    logger.error(`[comfyui-launcher] Invalid ComfyUI path: ${comfyPath}`)
    return false
  }

  const mainPy = path.join(comfyPath, 'main.py')
  if (!fs.existsSync(mainPy)) {
    logger.error(`[comfyui-launcher] main.py not found at: ${mainPy}`)
    return false
  }

  const python = findComfyPython(comfyPath)
  if (!python) {
    logger.error('[comfyui-launcher] Could not find Python executable in ComfyUI installation')
    return false
  }

  logger.info(`[comfyui-launcher] Starting ComfyUI: ${python} ${mainPy}`)

  comfyProcess = spawn(python, ['main.py'], {
    cwd: comfyPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  })

  comfyProcess.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().trim()
    if (lines) {
      for (const line of lines.split('\n')) {
        logger.info(`[comfyui] ${line}`)
      }
    }
  })

  comfyProcess.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().trim()
    if (lines) {
      for (const line of lines.split('\n')) {
        logger.info(`[comfyui] ${line}`)
      }
    }
  })

  comfyProcess.on('exit', (code, signal) => {
    logger.info(`[comfyui-launcher] ComfyUI exited (code=${code}, signal=${signal})`)
    comfyProcess = null
  })

  comfyProcess.on('error', (err) => {
    logger.error(`[comfyui-launcher] Failed to start ComfyUI: ${err}`)
    comfyProcess = null
  })

  return true
}

/**
 * Stop the ComfyUI child process if we started it.
 */
export function stopComfyUI(): void {
  if (!comfyProcess || comfyProcess.killed) return

  logger.info('[comfyui-launcher] Stopping ComfyUI...')
  comfyProcess.kill('SIGTERM')

  // Force kill after 5 seconds if still running
  const forceKillTimer = setTimeout(() => {
    if (comfyProcess && !comfyProcess.killed) {
      logger.warn('[comfyui-launcher] Force killing ComfyUI')
      comfyProcess.kill('SIGKILL')
    }
  }, 5000)

  comfyProcess.on('exit', () => {
    clearTimeout(forceKillTimer)
  })
}

/**
 * Check if we have a running ComfyUI child process.
 */
export function isComfyUIRunning(): boolean {
  return comfyProcess !== null && !comfyProcess.killed
}
