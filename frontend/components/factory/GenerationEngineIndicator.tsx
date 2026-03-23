import { useState, useEffect } from 'react'
import { Cloud, Cpu } from 'lucide-react'

type Engine = 'api' | 'local' | 'unknown'

/** Shows whether video generation uses LTX Cloud API or Local GPU. */
export function GenerationEngineIndicator() {
  const [engine, setEngine] = useState<Engine>('unknown')

  useEffect(() => {
    const check = async () => {
      try {
        const resp = await fetch('http://localhost:8000/api/settings')
        if (!resp.ok) { setEngine('unknown'); return }
        const data = await resp.json()
        const hasKey = data.has_ltx_api_key === true
        const prefers = data.user_prefers_ltx_api_video_generations === true
        setEngine(hasKey && prefers ? 'api' : 'local')
      } catch {
        setEngine('unknown')
      }
    }
    void check()
    // Re-check every 30 seconds
    const timer = setInterval(() => void check(), 30_000)
    return () => clearInterval(timer)
  }, [])

  if (engine === 'unknown') return null

  const isApi = engine === 'api'

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${
        isApi
          ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
      }`}
      title={isApi ? 'Video generation via LTX Cloud API' : 'Video generation via local ComfyUI GPU'}
    >
      {isApi ? <Cloud className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
      {isApi ? 'LTX API' : 'Local GPU'}
    </div>
  )
}
