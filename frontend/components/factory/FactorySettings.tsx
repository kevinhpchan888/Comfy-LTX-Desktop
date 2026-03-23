import { useState } from 'react'
import {
  Cpu, Zap, Settings2, Brain, Timer,
  CheckCircle2, XCircle, Loader2, RefreshCw,
} from 'lucide-react'
import type { AppSettings } from '../../contexts/AppSettingsContext'
import type { GpuCapabilities } from '../../types/factory'
import { PIPELINE_PRESETS, getCompatiblePresets } from '../../lib/factory-gpu'

type SettingsTab = 'ai' | 'generation' | 'gpu' | 'advanced' | 'presets'

interface FactorySettingsProps {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => void
  gpuInfo: GpuCapabilities | null
  onRefreshGpu: () => void
  onTestConnection: () => Promise<boolean>
}

export function FactorySettings({
  settings,
  onUpdate,
  gpuInfo,
  onRefreshGpu,
  onTestConnection,
}: FactorySettingsProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'ai', label: 'AI Provider', icon: <Brain className="h-3.5 w-3.5" /> },
    { id: 'generation', label: 'Generation', icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'gpu', label: 'GPU', icon: <Cpu className="h-3.5 w-3.5" /> },
    { id: 'presets', label: 'Presets', icon: <Settings2 className="h-3.5 w-3.5" /> },
    { id: 'advanced', label: 'Advanced', icon: <Timer className="h-3.5 w-3.5" /> },
  ]

  const handleTestConnection = async () => {
    setTestStatus('testing')
    try {
      const ok = await onTestConnection()
      setTestStatus(ok ? 'success' : 'error')
    } catch {
      setTestStatus('error')
    }
    setTimeout(() => setTestStatus('idle'), 3000)
  }

  return (
    <div className="p-4">
      <h3 className="text-lg font-semibold text-white mb-4">Factory Settings</h3>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b border-zinc-800 pb-2">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-zinc-800 text-white'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'ai' && (
        <div className="space-y-4">
          <FieldGroup label="Provider">
            <select
              value={settings.factoryAiProvider}
              onChange={e => onUpdate({ factoryAiProvider: e.target.value as AppSettings['factoryAiProvider'] })}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="anthropic">Anthropic (Direct)</option>
              <option value="local">Local Proxy (LiteLLM/Ollama)</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </FieldGroup>

          {(settings.factoryAiProvider === 'anthropic' || settings.factoryAiProvider === 'hybrid') && (
            <>
              <FieldGroup label="Anthropic API Key">
                <input
                  type="password"
                  value={settings.factoryAnthropicApiKey}
                  onChange={e => onUpdate({ factoryAnthropicApiKey: e.target.value })}
                  placeholder="sk-ant-..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600"
                />
              </FieldGroup>
              <FieldGroup label="Anthropic Model">
                <input
                  value={settings.factoryAnthropicModel}
                  onChange={e => onUpdate({ factoryAnthropicModel: e.target.value })}
                  placeholder="claude-sonnet-4-6"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600"
                />
              </FieldGroup>
            </>
          )}

          {(settings.factoryAiProvider === 'local' || settings.factoryAiProvider === 'hybrid') && (
            <>
              <FieldGroup label="Proxy URL">
                <input
                  value={settings.factoryProxyUrl}
                  onChange={e => onUpdate({ factoryProxyUrl: e.target.value })}
                  placeholder="http://localhost:4000"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600"
                />
              </FieldGroup>
              <FieldGroup label="Proxy Token">
                <input
                  type="password"
                  value={settings.factoryProxyToken}
                  onChange={e => onUpdate({ factoryProxyToken: e.target.value })}
                  placeholder="Optional bearer token"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600"
                />
              </FieldGroup>
              <FieldGroup label="Proxy Model">
                <input
                  value={settings.factoryProxyModel}
                  onChange={e => onUpdate({ factoryProxyModel: e.target.value })}
                  placeholder="ollama/qwen3-32b"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600"
                />
              </FieldGroup>
            </>
          )}

          <button
            onClick={handleTestConnection}
            disabled={testStatus === 'testing'}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            {testStatus === 'testing' && <Loader2 className="h-4 w-4 animate-spin" />}
            {testStatus === 'success' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
            {testStatus === 'error' && <XCircle className="h-4 w-4 text-red-400" />}
            {testStatus === 'idle' && 'Test Connection'}
            {testStatus === 'testing' && 'Testing...'}
            {testStatus === 'success' && 'Connected'}
            {testStatus === 'error' && 'Failed'}
          </button>
        </div>
      )}

      {activeTab === 'generation' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Default Duration (s)">
              <input
                type="number"
                value={settings.factoryDefaultDuration}
                onChange={e => onUpdate({ factoryDefaultDuration: Number(e.target.value) })}
                min={1}
                max={30}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
            <FieldGroup label="Default FPS">
              <input
                type="number"
                value={settings.factoryDefaultFps}
                onChange={e => onUpdate({ factoryDefaultFps: Number(e.target.value) })}
                min={8}
                max={60}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Default Resolution">
              <select
                value={settings.factoryDefaultResolution}
                onChange={e => onUpdate({ factoryDefaultResolution: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="540p">540p</option>
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
            </FieldGroup>
            <FieldGroup label="Default Aspect Ratio">
              <select
                value={settings.factoryDefaultAspectRatio}
                onChange={e => onUpdate({ factoryDefaultAspectRatio: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              >
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="3:4">3:4</option>
              </select>
            </FieldGroup>
          </div>
          <FieldGroup label="Default Iterations per Shot">
            <input
              type="number"
              value={settings.factoryDefaultIterations}
              onChange={e => onUpdate({ factoryDefaultIterations: Number(e.target.value) })}
              min={1}
              max={10}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
            />
          </FieldGroup>
        </div>
      )}

      {activeTab === 'gpu' && (
        <div className="space-y-4">
          {gpuInfo ? (
            <div className="bg-zinc-800/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium text-white">Detected GPU</h4>
                <button
                  onClick={onRefreshGpu}
                  className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Name</span>
                  <span className="text-white">{gpuInfo.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">VRAM</span>
                  <span className="text-white">{gpuInfo.vramGb} GB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">CUDA</span>
                  <span className={gpuInfo.cudaAvailable ? 'text-green-400' : 'text-red-400'}>
                    {gpuInfo.cudaAvailable ? 'Available' : 'Not Available'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Status</span>
                  <span className={gpuInfo.available ? 'text-green-400' : 'text-red-400'}>
                    {gpuInfo.available ? 'Ready' : 'Unavailable'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-800/50 rounded-lg p-4 text-center">
              <p className="text-zinc-500 text-sm">No GPU detected</p>
              <button
                onClick={onRefreshGpu}
                className="mt-2 text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Refresh
              </button>
            </div>
          )}

          {gpuInfo && gpuInfo.vramGb > 0 && (
            <div>
              <h4 className="text-sm font-medium text-white mb-2">Compatible Presets</h4>
              <div className="space-y-1.5">
                {getCompatiblePresets(gpuInfo.vramGb).map(preset => (
                  <div key={preset.id} className="flex items-center justify-between bg-zinc-800/50 rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm text-white">{preset.label}</p>
                      <p className="text-[11px] text-zinc-500">{preset.description}</p>
                    </div>
                    <span className="text-[10px] text-zinc-500">{preset.minVram}GB+</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'presets' && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500 mb-3">
            Pipeline presets define checkpoint, steps, CFG, and sampler combinations optimized for different use cases.
          </p>
          {PIPELINE_PRESETS.map(preset => (
            <div key={preset.id} className="bg-zinc-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-medium text-white">{preset.label}</h4>
                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded">
                  {preset.minVram}GB VRAM
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mb-2">{preset.description}</p>
              <div className="flex gap-3 text-[10px] text-zinc-500">
                <span>Checkpoint: {preset.checkpoint}</span>
                <span>Steps: {preset.steps}</span>
                <span>CFG: {preset.cfg}</span>
                <span>Sampler: {preset.sampler}</span>
                {preset.speedLora && <span className="text-amber-400">+Speed LoRA</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'advanced' && (
        <div className="space-y-4">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Timing &amp; Reliability</h4>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Delay Between Shots (ms)">
              <input
                type="number"
                value={settings.factoryDelayBetweenShots}
                onChange={e => onUpdate({ factoryDelayBetweenShots: Number(e.target.value) })}
                min={0}
                step={1000}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
            <FieldGroup label="Render Timeout (ms)">
              <input
                type="number"
                value={settings.factoryRenderTimeout}
                onChange={e => onUpdate({ factoryRenderTimeout: Number(e.target.value) })}
                min={30000}
                step={30000}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Max Retries">
              <input
                type="number"
                value={settings.factoryMaxRetries}
                onChange={e => onUpdate({ factoryMaxRetries: Number(e.target.value) })}
                min={0}
                max={10}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
            <FieldGroup label="Progress Poll Interval (ms)">
              <input
                type="number"
                value={settings.factoryProgressPollInterval}
                onChange={e => onUpdate({ factoryProgressPollInterval: Number(e.target.value) })}
                min={500}
                step={500}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
          </div>

          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide pt-2">State Management</h4>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="Auto-Save Interval (ms)">
              <input
                type="number"
                value={settings.factoryAutoSaveInterval}
                onChange={e => onUpdate({ factoryAutoSaveInterval: Number(e.target.value) })}
                min={5000}
                step={5000}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
              />
            </FieldGroup>
            <FieldGroup label="Crash Recovery">
              <label className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  checked={settings.factoryCrashRecovery}
                  onChange={e => onUpdate({ factoryCrashRecovery: e.target.checked })}
                  className="rounded border-zinc-600 bg-zinc-800 text-blue-500"
                />
                <span className="text-sm text-zinc-300">Enable crash recovery</span>
              </label>
            </FieldGroup>
          </div>
        </div>
      )}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
