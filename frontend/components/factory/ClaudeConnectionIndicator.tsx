import { useState, useEffect, useRef } from 'react'

type ConnectionStatus = 'connected' | 'stale' | 'disconnected'

interface HeartbeatData {
  timestamp: string
  epoch: number
  lastTool: string
  pid: number
}

/** Polls the MCP heartbeat file to show Claude Code connection status. */
export function ClaudeConnectionIndicator() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected')
  const [lastTool, setLastTool] = useState<string | null>(null)
  const [lastSeen, setLastSeen] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const checkHeartbeat = async () => {
      try {
        // Try reading from ~/.ltx-desktop/.mcp-heartbeat.json
        const home = await getHomePath()
        if (!home) {
          setStatus('disconnected')
          return
        }

        const heartbeatPath = `${home}/.ltx-desktop/.mcp-heartbeat.json`
        const exists = await window.electronAPI.checkFilesExist([heartbeatPath])

        if (!exists[heartbeatPath]) {
          setStatus('disconnected')
          return
        }

        const result = await window.electronAPI.readLocalFile?.(heartbeatPath)
        if (!result?.data) {
          setStatus('disconnected')
          return
        }

        const text = atob(result.data)
        const heartbeat: HeartbeatData = JSON.parse(text)
        const ageSeconds = (Date.now() / 1000) - heartbeat.epoch

        setLastTool(heartbeat.lastTool)

        if (ageSeconds < 120) {
          // Active within 2 minutes
          setStatus('connected')
          setLastSeen('just now')
        } else if (ageSeconds < 600) {
          // Active within 10 minutes
          setStatus('stale')
          const mins = Math.round(ageSeconds / 60)
          setLastSeen(`${mins}m ago`)
        } else {
          setStatus('disconnected')
          const mins = Math.round(ageSeconds / 60)
          setLastSeen(`${mins}m ago`)
        }
      } catch {
        setStatus('disconnected')
      }
    }

    // Poll every 15 seconds
    void checkHeartbeat()
    timerRef.current = setInterval(() => void checkHeartbeat(), 15_000)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const dotColor = {
    connected: 'bg-green-500 shadow-green-500/50',
    stale: 'bg-yellow-500 shadow-yellow-500/50',
    disconnected: 'bg-zinc-600',
  }[status]

  const label = {
    connected: 'Claude Connected',
    stale: 'Claude Idle',
    disconnected: 'Claude Disconnected',
  }[status]

  const textColor = {
    connected: 'text-green-400',
    stale: 'text-yellow-400',
    disconnected: 'text-zinc-500',
  }[status]

  return (
    <div className="flex items-center gap-1.5" title={lastTool ? `Last: ${lastTool}${lastSeen ? ` (${lastSeen})` : ''}` : label}>
      <div className={`h-2 w-2 rounded-full shadow-sm ${dotColor} ${status === 'connected' ? 'animate-pulse' : ''}`} />
      <span className={`text-[10px] font-medium ${textColor}`}>{label}</span>
    </div>
  )
}

async function getHomePath(): Promise<string | null> {
  try {
    // Use downloads path as a proxy to get home directory
    const downloadsPath = await window.electronAPI.getDownloadsPath()
    // Downloads is typically ~/Downloads, so go up one level
    const parts = downloadsPath.replace(/\\/g, '/').split('/')
    parts.pop() // Remove 'Downloads'
    return parts.join('/')
  } catch {
    return null
  }
}
