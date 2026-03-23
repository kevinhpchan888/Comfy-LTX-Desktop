import { useState, useCallback, useEffect } from 'react'
import {
  Image, Play, CheckCircle2, FolderOutput,
  Settings, MessageSquare, AlertTriangle,
  Plus, Trash2, CheckSquare, X, Send, Film,
} from 'lucide-react'
import { useFactory } from '../contexts/FactoryContext'
import { ManifestImporter } from '../components/factory/ManifestImporter'
import { StoryboardGrid } from '../components/factory/StoryboardGrid'
import { ShotDetail } from '../components/factory/ShotDetail'
import { ComparisonViewer } from '../components/factory/ComparisonViewer'
import { ImageLightbox } from '../components/factory/ImageLightbox'
import { FactoryProgressBar } from '../components/factory/FactoryProgressBar'
import { CreativeConsole } from '../components/factory/CreativeConsole'
import { FactorySettings } from '../components/factory/FactorySettings'
import { NewShotDialog } from '../components/factory/NewShotDialog'
import { useAppSettings } from '../contexts/AppSettingsContext'

export function ShotFactory() {
  const {
    manifest,
    importManifest,
    clearFactory,
    shots,
    selectedShotId,
    selectShot,
    phase,
    progress,
    stats,
    cancelPipeline,
    generateFrame,
    generateAllFrames,
    renderVideo,
    renderAllVideos,
    approveIteration,
    toggleShotEnabled,
    updateShotManifest,
    organizeOutput,
    gpuInfo,
    refreshGpuInfo,
    gpuWarnings,
    chatMessages,
    sendChatMessage,
    applyShotPreview,
    isChatStreaming,
    // Multi-select
    selectedShotIds,
    toggleShotSelection,
    selectShotRange,
    selectAllShots,
    deselectAllShots,
    deleteShots,
    addNewShot,
    sendToEditor,
    sendToEditorAndExport,
    reorderShots,
  } = useFactory()

  const { settings, updateSettings } = useAppSettings()
  const [comparisonShotId, setComparisonShotId] = useState<string | null>(null)
  const [showConsole, setShowConsole] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showNewShot, setShowNewShot] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [lightboxShotId, setLightboxShotId] = useState<string | null>(null)
  const lightboxShot = shots.find(s => s.manifest.id === lightboxShotId) || null

  const selectedShot = shots.find(s => s.manifest.id === selectedShotId) || null
  const comparisonShot = shots.find(s => s.manifest.id === comparisonShotId) || null
  const hasMultiSelect = selectedShotIds.size > 0

  // Ctrl+K toggles creative console
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'k') {
        e.preventDefault()
        setShowConsole(prev => !prev)
      }
      // Delete key removes selected shots
      if ((e.key === 'Delete' || e.key === 'Backspace') && hasMultiSelect && !e.ctrlKey) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        deleteShots([...selectedShotIds])
      }
      // Ctrl+A selects all
      if (e.ctrlKey && e.key === 'a' && manifest) {
        const target = e.target as HTMLElement
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
        e.preventDefault()
        selectAllShots()
      }
      // Escape deselects
      if (e.key === 'Escape' && hasMultiSelect) {
        deselectAllShots()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasMultiSelect, selectedShotIds, deleteShots, selectAllShots, deselectAllShots, manifest])

  const handleTestConnection = useCallback(async () => {
    const { createLLMService } = await import('../lib/llm-service')
    const service = createLLMService({
      aiProvider: settings.factoryAiProvider,
      anthropicApiKey: settings.factoryAnthropicApiKey,
      anthropicModel: settings.factoryAnthropicModel,
      proxyUrl: settings.factoryProxyUrl,
      proxyToken: settings.factoryProxyToken,
      proxyModel: settings.factoryProxyModel,
    })
    return service.testConnection()
  }, [settings])

  // No manifest loaded — show importer
  if (!manifest) {
    return (
      <div className="h-full flex flex-col bg-zinc-950">
        <ManifestImporter onImport={importManifest} />
      </div>
    )
  }

  const isProcessing = phase !== 'idle' && phase !== 'complete' && phase !== 'reviewing'

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Selection toolbar — appears when shots are checkbox-selected */}
      {hasMultiSelect && (
        <div className="flex items-center gap-3 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2">
          <CheckSquare className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-medium text-blue-300">
            {selectedShotIds.size} shot{selectedShotIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2 ml-4">
            <button
              onClick={selectAllShots}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              <CheckSquare className="h-3 w-3" />
              Select All
            </button>
            <button
              onClick={() => sendToEditor([...selectedShotIds])}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-green-400 transition-colors hover:bg-green-500/10"
            >
              <Send className="h-3 w-3" />
              Send to Editor
            </button>
            <button
              onClick={() => sendToEditorAndExport([...selectedShotIds])}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-blue-400 transition-colors hover:bg-blue-500/10"
            >
              <Film className="h-3 w-3" />
              Send &amp; Stitch
            </button>
            <button
              onClick={() => deleteShots([...selectedShotIds])}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/10"
            >
              <Trash2 className="h-3 w-3" />
              Delete ({selectedShotIds.size})
            </button>
          </div>
          <button
            onClick={deselectAllShots}
            className="ml-auto rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Three-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel — Project Info + Actions */}
        <div className="w-56 flex-shrink-0 border-r border-zinc-800 flex flex-col">
          {/* Project header */}
          <div className="px-3 py-3 border-b border-zinc-800/60">
            <h2 className="text-sm font-medium text-white truncate">{manifest.project.name}</h2>
            <p className="text-[11px] text-zinc-500 mt-0.5 truncate">{manifest.project.description}</p>
            <div className="flex items-center gap-2 mt-2 text-[10px] text-zinc-500">
              <span>{stats.total} shots</span>
              <span className="text-zinc-700">|</span>
              <span>{stats.totalDuration}s total</span>
            </div>
          </div>

          {/* GPU Info */}
          {gpuInfo && (
            <div className="px-3 py-2 border-b border-zinc-800/60">
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className={`w-1.5 h-1.5 rounded-full ${gpuInfo.available ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-zinc-400 truncate">{gpuInfo.name}</span>
              </div>
              {gpuInfo.vramGb > 0 && (
                <p className="text-[10px] text-zinc-600 mt-0.5">{gpuInfo.vramGb} GB VRAM</p>
              )}
              {gpuWarnings.length > 0 && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{gpuWarnings.length} warning{gpuWarnings.length !== 1 ? 's' : ''}</span>
                </div>
              )}
            </div>
          )}

          {/* Scene tree (scrollable) */}
          <div className="flex-1 overflow-y-auto px-2 py-2">
            {Array.from(new Set(shots.map(s => s.manifest.scene))).map(scene => {
              const sceneShots = shots.filter(s => s.manifest.scene === scene)
              return (
                <div key={scene} className="mb-2">
                  <p className="text-[10px] text-zinc-500 font-medium px-1 mb-1 uppercase tracking-wide">{scene}</p>
                  {sceneShots.map(shot => (
                    <button
                      key={shot.manifest.id}
                      onClick={() => selectShot(shot.manifest.id)}
                      className={`w-full flex items-center gap-1.5 px-2 py-1 rounded text-left text-[11px] transition-colors ${
                        selectedShotId === shot.manifest.id
                          ? 'bg-zinc-800 text-white'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                      }`}
                    >
                      <ShotStatusDot status={shot.status} />
                      <span className="truncate">{shot.manifest.id}</span>
                    </button>
                  ))}
                </div>
              )
            })}
          </div>

          {/* Action buttons */}
          <div className="px-3 py-3 border-t border-zinc-800 space-y-1.5">
            <ActionButton
              icon={<Image className="h-3.5 w-3.5" />}
              label={`Generate Frames (${stats.idle})`}
              onClick={generateAllFrames}
              disabled={stats.idle === 0 || isProcessing}
            />
            <ActionButton
              icon={<Play className="h-3.5 w-3.5" />}
              label={`Render All (${stats.framesReady - stats.rendered})`}
              onClick={renderAllVideos}
              disabled={stats.framesReady <= stats.rendered || isProcessing}
            />
            <ActionButton
              icon={<CheckCircle2 className="h-3.5 w-3.5" />}
              label={`Approved: ${stats.approved}`}
              onClick={() => {}}
              disabled
            />
            <ActionButton
              icon={<FolderOutput className="h-3.5 w-3.5" />}
              label="Organize Output"
              onClick={organizeOutput}
              disabled={stats.rendered === 0 || isProcessing}
            />
            {/* Add Shot / Clear All */}
            <div className="flex gap-1.5">
              <div className="flex-1">
                <ActionButton
                  icon={<Plus className="h-3.5 w-3.5" />}
                  label="Add Shot"
                  onClick={() => setShowNewShot(true)}
                  disabled={isProcessing}
                />
              </div>
              <div className="flex-1">
                <ActionButton
                  icon={<Trash2 className="h-3.5 w-3.5" />}
                  label="Clear All"
                  onClick={() => setShowClearConfirm(true)}
                  disabled={isProcessing || shots.length === 0}
                />
              </div>
            </div>
            <div className="flex gap-1.5 pt-1">
              <button
                onClick={() => setShowSettings(true)}
                className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
              >
                <Settings className="h-3 w-3" />
                Settings
              </button>
              <button
                onClick={() => setShowConsole(!showConsole)}
                className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-[11px] transition-colors ${
                  showConsole ? 'text-violet-400 bg-violet-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
                }`}
              >
                <MessageSquare className="h-3 w-3" />
                AI
              </button>
            </div>
            <button
              onClick={clearFactory}
              className="w-full text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors pt-1"
            >
              Close Manifest
            </button>
          </div>
        </div>

        {/* Center Panel — Storyboard Grid */}
        <div className="flex-1 min-w-0 overflow-auto p-4">
          <StoryboardGrid
            shots={shots}
            selectedShotId={selectedShotId}
            selectedShotIds={selectedShotIds}
            onSelect={selectShot}
            onToggleSelect={toggleShotSelection}
            onRangeSelect={selectShotRange}
            onDoubleClick={(id) => {
              const shot = shots.find(s => s.manifest.id === id)
              if (shot && shot.frameIterations.length > 0) {
                setLightboxShotId(id)
              } else if (shot && shot.videoIterations.length > 0) {
                setComparisonShotId(id)
              }
            }}
            onReorder={reorderShots}
            gpuWarnings={gpuWarnings}
          />
        </div>

        {/* Right Panel — Shot Detail or Creative Console */}
        {showConsole ? (
          <CreativeConsole
            messages={chatMessages}
            onSend={sendChatMessage}
            onApplyPreview={applyShotPreview}
            isStreaming={isChatStreaming}
            isOpen={showConsole}
            onClose={() => setShowConsole(false)}
          />
        ) : selectedShot ? (
          <div className="w-80 flex-shrink-0 border-l border-zinc-800 overflow-y-auto">
            <ShotDetail
              shot={selectedShot}
              gpuWarnings={gpuWarnings.filter(w => w.shotId === selectedShot.manifest.id)}
              vramGb={gpuInfo?.vramGb || 0}
              onGenerateFrame={() => generateFrame(selectedShot.manifest.id)}
              onRenderVideo={() => renderVideo(selectedShot.manifest.id)}
              onApprove={(idx) => approveIteration(selectedShot.manifest.id, idx)}
              onToggleEnabled={() => toggleShotEnabled(selectedShot.manifest.id)}
              onUpdateManifest={(updates) => updateShotManifest(selectedShot.manifest.id, updates)}
              onDelete={() => deleteShots([selectedShot.manifest.id])}
              onSendToEditor={() => sendToEditor([selectedShot.manifest.id])}
              onSendToEditorAndExport={() => sendToEditorAndExport([selectedShot.manifest.id])}
              onImageDoubleClick={() => setLightboxShotId(selectedShot.manifest.id)}
            />
          </div>
        ) : (
          <div className="w-80 flex-shrink-0 border-l border-zinc-800 flex items-center justify-center">
            <p className="text-zinc-600 text-sm">Select a shot to view details</p>
          </div>
        )}
      </div>

      {/* Bottom — Progress Bar */}
      <FactoryProgressBar
        phase={phase}
        progress={progress}
        stats={stats}
        onCancel={cancelPipeline}
      />

      {/* Image Lightbox Modal */}
      {lightboxShot && lightboxShot.frameIterations.length > 0 && (
        <ImageLightbox
          frames={lightboxShot.frameIterations}
          activeIndex={lightboxShot.activeFrameIndex >= 0 ? lightboxShot.activeFrameIndex : 0}
          shotId={lightboxShot.manifest.id}
          onClose={() => setLightboxShotId(null)}
        />
      )}

      {/* Comparison Viewer Modal */}
      {comparisonShot && (
        <ComparisonViewer
          shot={comparisonShot}
          onClose={() => setComparisonShotId(null)}
          onApprove={(idx) => approveIteration(comparisonShot.manifest.id, idx)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 rounded-xl border border-zinc-700 w-[640px] max-h-[80vh] overflow-y-auto">
            <FactorySettings
              settings={settings}
              onUpdate={updateSettings}
              gpuInfo={gpuInfo}
              onRefreshGpu={refreshGpuInfo}
              onTestConnection={handleTestConnection}
            />
            <div className="flex justify-end px-4 pb-4">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Shot Dialog */}
      {showNewShot && (
        <NewShotDialog
          existingIds={shots.map(s => s.manifest.id)}
          nextOrder={shots.length > 0 ? Math.max(...shots.map(s => s.manifest.order)) + 1 : 1}
          defaultScene={selectedShot?.manifest.scene || shots[0]?.manifest.scene || 'New Scene'}
          scenes={[...new Set(shots.map(s => s.manifest.scene))]}
          selectedShotId={selectedShotId}
          onAdd={addNewShot}
          onClose={() => setShowNewShot(false)}
        />
      )}

      {/* Clear All Confirmation */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[400px] rounded-xl border border-zinc-700 bg-zinc-900 p-6">
            <h3 className="text-sm font-semibold text-zinc-100 mb-2">Clear All Shots?</h3>
            <p className="text-xs text-zinc-400 mb-4">
              This will remove all {shots.length} shots and their generated frames/videos.
              This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deleteShots(shots.map(s => s.manifest.id))
                  setShowClearConfirm(false)
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
              >
                Clear All Shots
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helper Components ──────────────────────────────────────────────────────

function ShotStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    'idle': 'border border-zinc-600 bg-transparent',
    'generating-frame': 'bg-blue-500 animate-pulse',
    'frame-ready': 'bg-blue-500',
    'rendering-video': 'bg-blue-500 animate-pulse',
    'video-ready': 'bg-green-500',
    'approved': 'bg-green-400',
    'error': 'bg-red-500',
    'disabled': 'bg-zinc-700',
  }
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[status] || 'bg-zinc-600'}`} />
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors ${
        disabled
          ? 'text-zinc-600 cursor-not-allowed'
          : 'text-zinc-300 hover:text-white hover:bg-zinc-800'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
