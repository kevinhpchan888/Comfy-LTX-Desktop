import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Image,
  Video,
  Settings,
  Layers,
  Film,
  FileText,
  Play,
  RefreshCw,
  Check,
  EyeOff,
  Eye,
} from 'lucide-react'
import type { FactoryShot, ValidationWarning } from '../../types/factory'
import { parseDuration } from '../../lib/factory-manifest'

interface ShotDetailProps {
  shot: FactoryShot
  gpuWarnings: ValidationWarning[]
  vramGb: number
  onGenerateFrame: () => void
  onRenderVideo: () => void
  onApprove: (index: number) => void
  onToggleEnabled: () => void
}

function Section({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800/50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
        <span className="text-zinc-400">{icon}</span>
        {title}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  )
}

export function ShotDetail({
  shot,
  gpuWarnings,
  vramGb,
  onGenerateFrame,
  onRenderVideo,
  onApprove,
  onToggleEnabled,
}: ShotDetailProps) {
  const m = shot.manifest
  const activeFrame = shot.frameIterations[shot.activeFrameIndex]
  const duration = parseDuration(m.video.duration)
  const promptWords = m.video.prompt.trim().split(/\s+/).length

  // VRAM estimate
  const estimatedVram = vramGb > 0 ? Math.round(vramGb * 0.8) : 0
  const vramColor = estimatedVram <= vramGb * 0.7 ? 'bg-green-500' : estimatedVram <= vramGb * 0.9 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-bold text-zinc-100">{m.id}</h2>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
            {shot.status.replace('-', ' ')}
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">{m.scene}</p>
        {m.description && (
          <p className="mt-1 text-xs text-zinc-300">{m.description}</p>
        )}
      </div>

      {/* Frame Previews */}
      <Section title="Frame Previews" icon={<Image className="h-3.5 w-3.5" />} defaultOpen>
        {activeFrame ? (
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <img src={activeFrame.url} alt="Frame preview" className="w-full" />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500">
                {activeFrame.seed !== undefined ? `Seed: ${activeFrame.seed}` : 'No seed info'}
              </span>
              <button
                onClick={onGenerateFrame}
                className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </button>
            </div>
            {m.frames.first && (
              <span className="text-[10px] text-zinc-500">
                Source: {m.frames.first.source}
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-700 bg-zinc-900 p-6">
            <Image className="h-8 w-8 text-zinc-600" />
            <p className="text-xs text-zinc-500">No frame generated yet</p>
            <button
              onClick={onGenerateFrame}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500"
            >
              Generate Frame
            </button>
            {m.frames.first && (
              <span className="text-[10px] text-zinc-500">
                Source: {m.frames.first.source}
              </span>
            )}
          </div>
        )}
      </Section>

      {/* Prompt */}
      <Section title="Prompt" icon={<FileText className="h-3.5 w-3.5" />} defaultOpen>
        <div className="relative">
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-900 p-3 text-xs text-zinc-300">
            {m.video.prompt}
          </div>
          <span className="mt-1 inline-block rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {promptWords} words
          </span>
        </div>
      </Section>

      {/* Settings */}
      <Section title="Settings" icon={<Settings className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <SettingRow label="Duration" value={`${duration}s`} />
          <SettingRow label="Resolution" value={m.video.resolution} />
          <SettingRow label="FPS" value={String(m.video.fps)} />
          <SettingRow label="Aspect" value={m.video.aspect_ratio} />
          <SettingRow label="Camera" value={m.video.camera_motion || 'none'} />
          <SettingRow label="Audio" value={m.video.audio ? 'Yes' : 'No'} />
          <SettingRow label="Film Grain" value={m.video.film_grain ? 'Yes' : 'No'} />
          <SettingRow label="Iterations" value={String(m.video.iterations)} />
        </div>
      </Section>

      {/* Pipeline */}
      <Section title="Pipeline" icon={<Layers className="h-3.5 w-3.5" />}>
        <div className="flex flex-col gap-2">
          {m.pipeline_overrides?.sampler && (
            <div className="text-xs text-zinc-400">
              Sampler: {m.pipeline_overrides.sampler.name} (CFG {m.pipeline_overrides.sampler.cfg_scale})
              {m.pipeline_overrides.sampler.steps && `, ${m.pipeline_overrides.sampler.steps} steps`}
            </div>
          )}
          {m.pipeline_overrides?.loras && (
            <div className="flex flex-col gap-1">
              {Object.entries(m.pipeline_overrides.loras).map(([key, lora]) =>
                lora?.enabled ? (
                  <span key={key} className="text-xs text-zinc-400">
                    LoRA [{key}]: {lora.preset || lora.file || 'default'} @ {lora.strength}
                  </span>
                ) : null,
              )}
            </div>
          )}
          {!m.pipeline_overrides && (
            <span className="text-xs text-zinc-500">Using project defaults</span>
          )}

          {/* VRAM estimate bar */}
          {vramGb > 0 && (
            <div className="mt-1">
              <div className="mb-1 flex justify-between text-[10px] text-zinc-500">
                <span>VRAM estimate</span>
                <span>{estimatedVram}GB / {vramGb}GB</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${vramColor}`}
                  style={{ width: `${Math.min((estimatedVram / vramGb) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

          {gpuWarnings.length > 0 && (
            <div className="mt-1 rounded border border-yellow-500/30 bg-yellow-500/10 p-2">
              {gpuWarnings.map((w, i) => (
                <p key={i} className="text-[11px] text-yellow-300">{w.message}</p>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* Render Results */}
      <Section title="Render Results" icon={<Film className="h-3.5 w-3.5" />}>
        {shot.videoIterations.length > 0 ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {shot.videoIterations.map((iter, idx) => (
              <div
                key={iter.id}
                className={`flex shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5 ${
                  idx === shot.activeVideoIndex
                    ? 'border-violet-500 ring-1 ring-violet-500'
                    : 'border-zinc-700'
                }`}
              >
                <div className="relative h-16 w-28 overflow-hidden rounded bg-zinc-800">
                  <video src={iter.url} className="h-full w-full object-cover" muted preload="metadata" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Play className="h-5 w-5 text-white/80" />
                  </div>
                </div>
                <span className="text-[10px] text-zinc-400">v{idx + 1}</span>
                <button
                  onClick={() => onApprove(idx)}
                  className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 transition-colors hover:bg-violet-600 hover:text-white"
                >
                  <Check className="h-2.5 w-2.5" />
                  Approve
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No renders yet. Generate a frame first, then render.</p>
        )}
      </Section>

      {/* Metadata */}
      <Section title="Metadata" icon={<Video className="h-3.5 w-3.5" />}>
        <div className="flex flex-col gap-1.5">
          {m.metadata.narration && (
            <MetaRow label="Narration" value={m.metadata.narration} />
          )}
          {m.metadata.source_books && m.metadata.source_books.length > 0 && (
            <MetaRow label="Sources" value={m.metadata.source_books.join(', ')} />
          )}
          {m.metadata.color_grade_note && (
            <MetaRow label="Color Note" value={m.metadata.color_grade_note} />
          )}
          {m.metadata.edit_note && (
            <MetaRow label="Edit Note" value={m.metadata.edit_note} />
          )}
          {m.metadata.timecode_estimate && (
            <MetaRow label="Timecode" value={m.metadata.timecode_estimate} />
          )}
          {!m.metadata.narration && !m.metadata.source_books?.length && !m.metadata.color_grade_note && !m.metadata.edit_note && !m.metadata.timecode_estimate && (
            <span className="text-xs text-zinc-500">No metadata</span>
          )}
        </div>
      </Section>

      {/* Actions */}
      <div className="mt-auto border-t border-zinc-800 p-4">
        <div className="flex gap-2">
          <button
            onClick={onGenerateFrame}
            disabled={shot.status === 'disabled'}
            className="flex-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Generate Frame
          </button>
          <button
            onClick={onRenderVideo}
            disabled={shot.status === 'disabled' || shot.status === 'idle'}
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Render Video
          </button>
          <button
            onClick={onToggleEnabled}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            {shot.status === 'disabled' ? (
              <>
                <Eye className="h-3.5 w-3.5" />
                Enable
              </>
            ) : (
              <>
                <EyeOff className="h-3.5 w-3.5" />
                Disable
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className="text-[11px] text-zinc-300">{value}</span>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      <p className="text-xs text-zinc-300">{value}</p>
    </div>
  )
}
