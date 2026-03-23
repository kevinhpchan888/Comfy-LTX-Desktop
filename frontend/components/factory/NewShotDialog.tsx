import { useState, useMemo } from 'react'
import { X } from 'lucide-react'
import type { ManifestShot } from '../../types/factory'

interface NewShotDialogProps {
  existingIds: string[]
  nextOrder: number
  defaultScene: string
  scenes: string[]
  selectedShotId: string | null
  onAdd: (shot: ManifestShot) => void
  onClose: () => void
}

/** Given a selected shot ID and all existing IDs, suggest the next sequential ID.
 *  e.g. "CO-03" selected → "CO-04", "A1-11" → "A1-12", "A1-06b" → "A1-06c" */
function suggestNextId(selectedId: string | null, existingIds: string[]): string {
  if (!selectedId) return ''

  // Try pattern: prefix + number (e.g. "CO-03", "A1-11")
  const numMatch = selectedId.match(/^(.+?)(\d+)$/)
  if (numMatch) {
    const prefix = numMatch[1]
    const num = parseInt(numMatch[2], 10)
    const padLen = numMatch[2].length

    // Find the next available number
    for (let next = num + 1; next < num + 100; next++) {
      const candidate = `${prefix}${String(next).padStart(padLen, '0')}`
      if (!existingIds.includes(candidate)) return candidate
    }
  }

  // Try pattern: prefix + number + letter suffix (e.g. "A1-06b")
  const letterMatch = selectedId.match(/^(.+?\d+)([a-z])$/)
  if (letterMatch) {
    const base = letterMatch[1]
    const letter = letterMatch[2]
    const nextLetter = String.fromCharCode(letter.charCodeAt(0) + 1)
    if (nextLetter <= 'z') {
      const candidate = `${base}${nextLetter}`
      if (!existingIds.includes(candidate)) return candidate
    }
  }

  return ''
}

export function NewShotDialog({ existingIds, nextOrder, defaultScene, scenes, selectedShotId, onAdd, onClose }: NewShotDialogProps) {
  const suggestedId = useMemo(() => suggestNextId(selectedShotId, existingIds), [selectedShotId, existingIds])

  const [id, setId] = useState(suggestedId)
  const [sceneMode, setSceneMode] = useState<'existing' | 'custom'>(
    scenes.includes(defaultScene) ? 'existing' : 'custom'
  )
  const [scene, setScene] = useState(defaultScene)
  const [customScene, setCustomScene] = useState('')
  const [description, setDescription] = useState('')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [firstFramePrompt, setFirstFramePrompt] = useState('')
  const [duration, setDuration] = useState('5')
  const [resolution, setResolution] = useState('720p')
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [cameraMotion, setCameraMotion] = useState('none')

  const effectiveScene = sceneMode === 'custom' ? customScene : scene
  const idError = id && existingIds.includes(id) ? 'ID already exists' : ''
  const canSubmit = id.trim() && effectiveScene.trim() && videoPrompt.trim() && !idError

  const handleSubmit = () => {
    if (!canSubmit) return

    const finalScene = effectiveScene.trim()
    const shot: ManifestShot = {
      id: id.trim(),
      scene: finalScene,
      scene_slug: finalScene.toLowerCase().replace(/\s+/g, '-'),
      description: description.trim(),
      act: 1,
      order: nextOrder,
      enabled: true,
      frames: {
        first: firstFramePrompt.trim()
          ? {
              source: 'generate',
              prompt: firstFramePrompt.trim(),
              negative_prompt: '',
              width: 1024,
              height: 576,
              steps: 20,
              guidance: 3.0,
              seed: null,
              engine: 'zit',
            }
          : null,
        middle: null,
        last: null,
      },
      video: {
        prompt: videoPrompt.trim(),
        model: 'pro',
        duration,
        resolution,
        fps: 24,
        iterations: 1,
        aspect_ratio: aspectRatio,
        audio: false,
        camera_motion: cameraMotion,
        prompt_enhance: false,
        spatial_upscale: false,
        temporal_upscale: false,
        film_grain: false,
      },
      video_alt: null,
      extend: null,
      pipeline_overrides: null,
      audio_layers: null,
      metadata: {},
    }

    onAdd(shot)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-h-[85vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-zinc-100">Add New Shot</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* ID + Scene row */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shot ID" required error={idError}>
              <input
                value={id}
                onChange={e => setId(e.target.value)}
                placeholder="e.g. A1-01"
                className="input-field"
              />
              {suggestedId && id !== suggestedId && (
                <button
                  type="button"
                  onClick={() => setId(suggestedId)}
                  className="mt-1 text-[10px] text-violet-400 hover:text-violet-300"
                >
                  Suggest: {suggestedId}
                </button>
              )}
            </Field>
            <Field label="Scene" required>
              <div className="flex flex-col gap-1.5">
                <select
                  value={sceneMode === 'custom' ? '__custom__' : scene}
                  onChange={e => {
                    if (e.target.value === '__custom__') {
                      setSceneMode('custom')
                    } else {
                      setSceneMode('existing')
                      setScene(e.target.value)
                    }
                  }}
                  className="input-field"
                >
                  {scenes.map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                  <option value="__custom__">+ New Scene...</option>
                </select>
                {sceneMode === 'custom' && (
                  <input
                    value={customScene}
                    onChange={e => setCustomScene(e.target.value)}
                    placeholder="Enter new scene name..."
                    autoFocus
                    className="input-field"
                  />
                )}
              </div>
            </Field>
          </div>

          {/* Description */}
          <Field label="Description">
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief shot description..."
              className="input-field"
            />
          </Field>

          {/* First Frame Prompt */}
          <Field label="First Frame Prompt (optional — leave empty to skip image generation)">
            <textarea
              value={firstFramePrompt}
              onChange={e => setFirstFramePrompt(e.target.value)}
              placeholder="Describe the opening frame..."
              rows={2}
              className="input-field resize-none"
            />
          </Field>

          {/* Video Prompt */}
          <Field label="Video Prompt" required>
            <textarea
              value={videoPrompt}
              onChange={e => setVideoPrompt(e.target.value)}
              placeholder="Describe the video scene in detail..."
              rows={4}
              className="input-field resize-none"
            />
          </Field>

          {/* Settings row */}
          <div className="grid grid-cols-4 gap-3">
            <Field label="Duration">
              <select value={duration} onChange={e => setDuration(e.target.value)} className="input-field">
                <option value="2">2s</option>
                <option value="5">5s</option>
                <option value="10">10s</option>
              </select>
            </Field>
            <Field label="Resolution">
              <select value={resolution} onChange={e => setResolution(e.target.value)} className="input-field">
                <option value="512p">512p</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </Field>
            <Field label="Aspect">
              <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)} className="input-field">
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
              </select>
            </Field>
            <Field label="Camera">
              <select value={cameraMotion} onChange={e => setCameraMotion(e.target.value)} className="input-field">
                <option value="none">None</option>
                <option value="dolly_in">Dolly In</option>
                <option value="dolly_out">Dolly Out</option>
                <option value="dolly_left">Dolly Left</option>
                <option value="dolly_right">Dolly Right</option>
                <option value="jib_up">Jib Up</option>
                <option value="jib_down">Jib Down</option>
                <option value="static">Static</option>
                <option value="focus_shift">Focus Shift</option>
              </select>
            </Field>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add Shot
          </button>
        </div>
      </div>

      {/* Inline styles for input fields to keep component self-contained */}
      <style>{`
        .input-field {
          width: 100%;
          border-radius: 0.5rem;
          border: 1px solid rgb(63 63 70);
          background: rgb(24 24 27);
          padding: 0.5rem 0.75rem;
          font-size: 0.8125rem;
          color: rgb(228 228 231);
          outline: none;
          transition: border-color 0.15s;
        }
        .input-field:focus {
          border-color: rgb(139 92 246);
        }
        .input-field::placeholder {
          color: rgb(113 113 122);
        }
      `}</style>
    </div>
  )
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-zinc-400">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </label>
      {children}
      {error && <span className="text-[10px] text-red-400">{error}</span>}
    </div>
  )
}
