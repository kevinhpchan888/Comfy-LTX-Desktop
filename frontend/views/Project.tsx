import { ArrowLeft, Sparkles, Film, Zap, Clock } from 'lucide-react'
import { useProjects } from '../contexts/ProjectContext'
import { useFactory } from '../contexts/FactoryContext'
import { LtxLogo } from '../components/LtxLogo'
import { Button } from '../components/ui/button'
import { GenSpace } from './GenSpace'
import { VideoEditor } from './VideoEditor'
import { ShotFactory } from './ShotFactory'
import type { ProjectTab } from '../types/project'

export function Project() {
  const { currentProject, currentTab, setCurrentTab, goHome } = useProjects()
  const { stats, manifest } = useFactory()
  
  if (!currentProject) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4">Project not found</p>
          <Button onClick={goHome}>Go Home</Button>
        </div>
      </div>
    )
  }
  
  const tabs: { id: ProjectTab; label: string; icon: React.ReactNode }[] = [
    { id: 'gen-space', label: 'Gen Space', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'video-editor', label: 'Video Editor', icon: <Film className="h-4 w-4" /> },
    { id: 'shot-factory', label: 'Factory', icon: <Zap className="h-4 w-4" /> },
  ]
  
  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-zinc-800">
        <div className="flex-1 flex items-center gap-4">
          {/* Back button and logo */}
          <button 
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          
          <LtxLogo className="h-5 w-auto text-white" />
          
          {/* Project name */}
          <span className="text-white font-medium">{currentProject.name}</span>

          {/* Factory stats — shown when a manifest is loaded */}
          {manifest && (
            <div className="flex items-center gap-3 ml-4 pl-4 border-l border-zinc-700">
              <div className="flex items-center gap-1.5 text-zinc-400">
                <Clock className="h-3.5 w-3.5" />
                <span className="text-xs font-medium">
                  {formatDuration(stats.totalDuration)}
                </span>
              </div>
              <span className="text-[10px] text-zinc-500">
                {stats.total} shots
              </span>
              {stats.approved > 0 && (
                <span className="text-[10px] text-green-400">
                  {stats.approved} approved
                </span>
              )}
              {stats.errors > 0 && (
                <span className="text-[10px] text-red-400">
                  {stats.errors} error{stats.errors !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </div>
        
        {/* Center - Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                currentTab === tab.id
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* Right spacer - equal to left to keep tabs centered */}
        <div className="flex-1" />
      </header>
      
      {/* Main Content - both views stay mounted to preserve state */}
      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 ${currentTab === 'gen-space' ? '' : 'invisible pointer-events-none'}`}>
          <GenSpace />
        </div>
        <div className={`absolute inset-0 ${currentTab === 'video-editor' ? '' : 'invisible pointer-events-none'}`}>
          <VideoEditor />
        </div>
        <div className={`absolute inset-0 ${currentTab === 'shot-factory' ? '' : 'invisible pointer-events-none'}`}>
          <ShotFactory />
        </div>
      </main>
    </div>
  )
}

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60)
  const secs = totalSeconds % 60
  if (mins === 0) return `${secs}s`
  return `${mins}m ${secs}s`
}
