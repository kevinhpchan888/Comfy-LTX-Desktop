import { useState } from 'react'
import { FileJson, Upload, ClipboardPaste, X } from 'lucide-react'

interface ManifestImporterProps {
  onImport: (json: string) => { success: boolean; errors: string[] }
}

export function ManifestImporter({ onImport }: ManifestImporterProps) {
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteValue, setPasteValue] = useState('')
  const [errors, setErrors] = useState<string[]>([])

  const handleFileImport = async () => {
    const files = await window.electronAPI.showOpenFileDialog({
      title: 'Import Shot Manifest',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
    })
    if (!files || files.length === 0) return

    try {
      const { data } = await window.electronAPI.readLocalFile(files[0])
      // readLocalFile returns base64 data
      const jsonString = atob(data)
      const result = onImport(jsonString)
      if (!result.success) {
        setErrors(result.errors)
      } else {
        setErrors([])
      }
    } catch (e) {
      setErrors([`Failed to read file: ${e instanceof Error ? e.message : 'unknown error'}`])
    }
  }

  const handlePasteImport = () => {
    if (!pasteValue.trim()) return
    const result = onImport(pasteValue)
    if (!result.success) {
      setErrors(result.errors)
    } else {
      setErrors([])
      setShowPasteModal(false)
      setPasteValue('')
    }
  }

  const handleClosePasteModal = () => {
    setShowPasteModal(false)
    setPasteValue('')
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-lg flex-col items-center gap-6 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-900/50 p-12 text-center">
        <FileJson className="h-16 w-16 text-zinc-500" />
        <div>
          <h2 className="text-xl font-semibold text-zinc-100">Import Manifest</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Load a shot manifest JSON file to begin batch generation. The manifest
            defines scenes, shots, prompts, and rendering settings.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => void handleFileImport()}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            <Upload className="h-4 w-4" />
            Import from File
          </button>
          <button
            onClick={() => setShowPasteModal(true)}
            className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
          >
            <ClipboardPaste className="h-4 w-4" />
            Paste JSON
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Tip: Use the Creative Console to generate a manifest from a story outline or screenplay.
        </p>

        {errors.length > 0 && (
          <div className="w-full rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-left">
            <p className="mb-2 text-sm font-medium text-red-400">
              Import failed with {errors.length} error{errors.length > 1 ? 's' : ''}:
            </p>
            <ul className="space-y-1">
              {errors.map((err, i) => (
                <li key={i} className="text-xs text-red-300">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {showPasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 flex w-full max-w-2xl flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">Paste Manifest JSON</h3>
              <button
                onClick={handleClosePasteModal}
                className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <textarea
              value={pasteValue}
              onChange={e => setPasteValue(e.target.value)}
              placeholder='{"manifest_version": "1.0", "project": {...}, "shots": [...]}'
              className="h-80 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 p-3 font-mono text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={handleClosePasteModal}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteImport}
                disabled={!pasteValue.trim()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
