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
  Trash2,
  Pencil,
  Send,
} from 'lucide-react'
import type { FactoryShot, ManifestShot, ValidationWarning } from '../../types/factory'
import { parseDuration } from '../../lib/factory-manifest'

interface ShotDetailProps {
  shot: FactoryShot
  gpuWarnings: ValidationWarning[]
  vramGb: number
  onGenerateFrame: () => void
  onRenderVideo: () => void
  onApprove: (index: number) => void
  onToggleEnabled: () => void
  onUpdateManifest: (updates: Partial<ManifestShot>) => void
  onDelete: () => void
  onSendToEditor: () => void
  onSendToEditorAndExport: () => void
  onImageDoubleClick?: () => void
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
  onUpdateManifest,
  onDelete,
  onSendToEditor,
  onSendToEditorAndExport,
  onImageDoubleClick,
}: ShotDetailProps) {
  const m = shot.manifest
  const activeFrame = shot.frameIterations[shot.activeFrameIndex]
  const duration = parseDuration(m.video.duration)
  const promptWords = m.video.prompt.trim().split(/\s+/).length

  // Inline editing state
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  // VRAM estimate
  const estimatedVram = vramGb > 0 ? Math.round(vramGb * 0.8) : 0
  const vramColor = estimatedVram <= vramGb * 0.7 ? 'bg-green-500' : estimatedVram <= vramGb * 0.9 ? 'bg-yellow-500' : 'bg-red-500'

  const startEdit = (field: string, value: string) => {
    setEditingField(field)
    setEditValue(value)
  }

  const commitEdit = (field: string) => {
    setEditingField(null)
    const trimmed = editValue.trim()
    if (!trimmed && field === 'videoPrompt') return // Don't allow empty video prompt

    switch (field) {
      case 'videoPrompt':
        onUpdateManifest({ video: { ...m.video, prompt: trimmed } })
        break
      case 'description':
        onUpdateManifest({ description: trimmed })
        break
      case 'firstFramePrompt':
        if (m.frames.first && m.frames.first.source === 'generate') {
          onUpdateManifest({
            frames: { ...m.frames, first: { ...m.frames.first, prompt: trimmed } },
          })
        }
        break
    }
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, field: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitEdit(field)
    }
    if (e.key === 'Escape') {
      setEditingField(null)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-zinc-950">
      {/* Header */}
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-sm font-bold text-zinc-100">{m.id}</h2>
          <div className="flex items-center gap-2">
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
              {shot.status.replace('-', ' ')}
            </span>
            <button
              onClick={onDelete}
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
              title="Delete shot"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-400">{m.scene}</p>
        {/* Editable description */}
        {editingField === 'description' ? (
          <input
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => commitEdit('description')}
            onKeyDown={e => handleEditKeyDown(e, 'description')}
            autoFocus
            className="mt-1 w-full rounded border border-violet-500 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none"
          />
        ) : (
          <p
            className="mt-1 cursor-pointer text-xs text-zinc-300 transition-colors hover:text-violet-300"
            onClick={() => startEdit('description', m.description)}
            title="Click to edit"
          >
            {m.description || <span className="italic text-zinc-500">No description — click to add</span>}
          </p>
        )}
      </div>

      {/* Frame Previews */}
      <Section title="Frame Previews" icon={<Image className="h-3.5 w-3.5" />} defaultOpen>
        {activeFrame ? (
          <div className="flex flex-col gap-2">
            <div
              className="overflow-hidden rounded-lg border border-zinc-800 cursor-zoom-in"
              onDoubleClick={onImageDoubleClick}
              title="Double-click to view full size"
            >
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
          </div>
        )}
        {/* First frame prompt (editable) */}
        {m.frames.first && m.frames.first.source === 'generate' && (
          <div className="mt-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-zinc-500">First Frame Prompt</span>
              {editingField !== 'firstFramePrompt' && (
                <button
                  onClick={() => startEdit('firstFramePrompt', m.frames.first && m.frames.first.source === 'generate' ? m.frames.first.prompt : '')}
                  className="rounded p-0.5 text-zinc-500 hover:text-violet-400"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </div>
            {editingField === 'firstFramePrompt' ? (
              <textarea
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => commitEdit('firstFramePrompt')}
                onKeyDown={e => handleEditKeyDown(e, 'firstFramePrompt')}
                autoFocus
                rows={3}
                className="w-full resize-none rounded border border-violet-500 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 outline-none"
              />
            ) : (
              <p className="text-xs text-zinc-400 whitespace-pre-wrap">
                {m.frames.first.prompt}
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Video Prompt (editable) */}
      <Section title={`Video Prompt (${promptWords} words)`} icon={<FileText className="h-3.5 w-3.5" />} defaultOpen>
        <div className="relative">
          {editingField === 'videoPrompt' ? (
            <textarea
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={() => commitEdit('videoPrompt')}
              onKeyDown={e => handleEditKeyDown(e, 'videoPrompt')}
              autoFocus
              rows={6}
              className="w-full resize-none rounded border border-violet-500 bg-zinc-900 px-3 py-2 text-xs text-zinc-300 outline-none"
            />
          ) : (
            <div
              className="group max-h-40 cursor-pointer overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-900 p-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
              onClick={() => startEdit('videoPrompt', m.video.prompt)}
              title="Click to edit"
            >
              {m.video.prompt}
              <Pencil className="ml-1 inline-block h-3 w-3 text-zinc-500 opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
          )}
        </div>
      </Section>

      {/* Video Settings (editable dropdowns) */}
      <Section title="Video Settings" icon={<Settings className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <EditableSelect
            label="Duration"
            value={String(duration)}
            options={[{ v: '2', l: '2s' }, { v: '5', l: '5s' }, { v: '10', l: '10s' }]}
            onChange={v => onUpdateManifest({ video: { ...m.video, duration: v } })}
          />
          <EditableSelect
            label="Resolution"
            value={m.video.resolution}
            options={[{ v: '512p', l: '512p' }, { v: '720p', l: '720p' }, { v: '1080p', l: '1080p' }]}
            onChange={v => onUpdateManifest({ video: { ...m.video, resolution: v } })}
          />
          <SettingRow label="FPS" value={String(m.video.fps)} />
          <EditableSelect
            label="Aspect"
            value={m.video.aspect_ratio}
            options={[{ v: '16:9', l: '16:9' }, { v: '9:16', l: '9:16' }]}
            onChange={v => onUpdateManifest({ video: { ...m.video, aspect_ratio: v } })}
          />
          <EditableSelect
            label="Camera"
            value={m.video.camera_motion || 'none'}
            options={[
              { v: 'none', l: 'None' }, { v: 'dolly_in', l: 'Dolly In' }, { v: 'dolly_out', l: 'Dolly Out' },
              { v: 'dolly_left', l: 'Dolly Left' }, { v: 'dolly_right', l: 'Dolly Right' },
              { v: 'jib_up', l: 'Jib Up' }, { v: 'jib_down', l: 'Jib Down' },
              { v: 'static', l: 'Static' }, { v: 'focus_shift', l: 'Focus Shift' },
            ]}
            onChange={v => onUpdateManifest({ video: { ...m.video, camera_motion: v } })}
          />
          <EditableToggle label="Audio" value={m.video.audio} onChange={v => onUpdateManifest({ video: { ...m.video, audio: v } })} />
          <EditableToggle label="Film Grain" value={m.video.film_grain} onChange={v => onUpdateManifest({ video: { ...m.video, film_grain: v } })} />
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
      <div className="mt-auto border-t border-zinc-800 p-4 space-y-2">
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
        {/* Send to Editor — only available when shot has rendered video */}
        {shot.videoIterations.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={onSendToEditor}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-green-500"
            >
              <Send className="h-3.5 w-3.5" />
              Send to Editor
            </button>
            <button
              onClick={onSendToEditorAndExport}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500"
            >
              <Film className="h-3.5 w-3.5" />
              Send &amp; Stitch
            </button>
          </div>
        )}
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

function EditableSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ v: string; l: string }>
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300 outline-none focus:border-violet-500"
      >
        {options.map(o => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </div>
  )
}

function EditableToggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
          value ? 'bg-violet-500/20 text-violet-300' : 'bg-zinc-800 text-zinc-500'
        }`}
      >
        {value ? 'Yes' : 'No'}
      </button>
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
