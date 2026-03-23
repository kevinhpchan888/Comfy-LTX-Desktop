import { useState, useCallback } from 'react'
import { Upload, Search, ExternalLink, Loader2, ImageIcon, Clapperboard } from 'lucide-react'

type ImageTab = 'upload' | 'pexels' | 'google' | 'remotion'

interface PexelsPhoto {
  id: number
  width: number
  height: number
  photographer: string
  src: {
    original: string
    large2x: string
    large: string
    medium: string
    small: string
    tiny: string
  }
  alt: string
}

interface ImageSearchPanelProps {
  /** Called when user selects an image (local file path) */
  onSelectLocalFile: (filePath: string) => void
  /** Called when user selects a web image (URL to download) */
  onSelectWebImage: (url: string, attribution?: string) => void
  /** Pexels API key from settings */
  pexelsApiKey: string
  /** Default search query (e.g. shot description) */
  defaultQuery?: string
  /** Shot ID for Remotion requests */
  shotId?: string
  /** Called when user requests a Remotion motion graphic generation */
  onRemotionRequest?: (description: string) => void
}

export function ImageSearchPanel({
  onSelectLocalFile,
  onSelectWebImage,
  pexelsApiKey,
  defaultQuery = '',
  shotId,
  onRemotionRequest,
}: ImageSearchPanelProps) {
  const [activeTab, setActiveTab] = useState<ImageTab>('upload')

  return (
    <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-900 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <TabButton active={activeTab === 'upload'} onClick={() => setActiveTab('upload')}>
          <Upload className="h-3 w-3" />
          Upload
        </TabButton>
        <TabButton active={activeTab === 'pexels'} onClick={() => setActiveTab('pexels')}>
          <ImageIcon className="h-3 w-3" />
          Pexels
        </TabButton>
        <TabButton active={activeTab === 'google'} onClick={() => setActiveTab('google')}>
          <Search className="h-3 w-3" />
          Google
        </TabButton>
        <TabButton active={activeTab === 'remotion'} onClick={() => setActiveTab('remotion')}>
          <Clapperboard className="h-3 w-3" />
          Remotion
        </TabButton>
      </div>

      {/* Tab content */}
      <div className="p-3">
        {activeTab === 'upload' && (
          <UploadTab onSelectFile={onSelectLocalFile} />
        )}
        {activeTab === 'pexels' && (
          <PexelsTab
            apiKey={pexelsApiKey}
            defaultQuery={defaultQuery}
            onSelect={onSelectWebImage}
          />
        )}
        {activeTab === 'google' && (
          <GoogleTab defaultQuery={defaultQuery} />
        )}
        {activeTab === 'remotion' && (
          <RemotionTab
            defaultDescription={defaultQuery}
            shotId={shotId}
            onSelectFile={onSelectLocalFile}
            onRequest={onRemotionRequest}
          />
        )}
      </div>
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-medium transition-colors ${
        active
          ? 'border-b-2 border-violet-500 text-violet-300 bg-zinc-800/50'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Upload Tab ──────────────────────────────────────────────────────────────

function UploadTab({ onSelectFile }: { onSelectFile: (path: string) => void }) {
  const handlePickFile = useCallback(async () => {
    const files = await window.electronAPI.showOpenFileDialog({
      title: 'Select Image',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (files && files.length > 0) {
      onSelectFile(files[0])
    }
  }, [onSelectFile])

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-zinc-600 p-6 transition-colors hover:border-violet-500 hover:bg-zinc-800/50"
        onClick={handlePickFile}
      >
        <Upload className="h-6 w-6 text-zinc-500" />
        <p className="text-xs text-zinc-400">Click to browse for an image</p>
        <p className="text-[10px] text-zinc-600">PNG, JPG, WebP, BMP, GIF</p>
      </div>
    </div>
  )
}

// ─── Pexels Tab ──────────────────────────────────────────────────────────────

function PexelsTab({
  apiKey,
  defaultQuery,
  onSelect,
}: {
  apiKey: string
  defaultQuery: string
  onSelect: (url: string, attribution?: string) => void
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [photos, setPhotos] = useState<PexelsPhoto[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  const searchPexels = useCallback(async (searchQuery: string, pageNum: number = 1) => {
    if (!apiKey) {
      setError('Pexels API key not configured. Add it in Factory Settings.')
      return
    }
    if (!searchQuery.trim()) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchQuery)}&per_page=12&page=${pageNum}`,
        {
          headers: { Authorization: apiKey },
        },
      )

      if (!response.ok) {
        if (response.status === 401) {
          setError('Invalid Pexels API key. Check Factory Settings.')
        } else {
          setError(`Pexels API error: ${response.status}`)
        }
        return
      }

      const data = await response.json()
      const newPhotos = data.photos as PexelsPhoto[]

      if (pageNum === 1) {
        setPhotos(newPhotos)
      } else {
        setPhotos(prev => [...prev, ...newPhotos])
      }

      setPage(pageNum)
      setHasMore(newPhotos.length === 12 && data.total_results > pageNum * 12)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [apiKey])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    void searchPexels(query, 1)
  }

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search Pexels for images..."
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="flex items-center gap-1 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
          Search
        </button>
      </form>

      {error && (
        <div className="rounded bg-red-500/10 border border-red-500/30 px-3 py-2 text-[11px] text-red-400">
          {error}
        </div>
      )}

      {photos.length > 0 && (
        <>
          <div className="grid grid-cols-3 gap-1.5 max-h-64 overflow-y-auto">
            {photos.map(photo => (
              <PexelsPhotoCard
                key={photo.id}
                photo={photo}
                onSelect={() => onSelect(
                  photo.src.large,
                  `Photo by ${photo.photographer} on Pexels`,
                )}
              />
            ))}
          </div>
          {hasMore && (
            <button
              onClick={() => void searchPexels(query, page + 1)}
              disabled={loading}
              className="self-center rounded bg-zinc-800 px-4 py-1.5 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-700 disabled:opacity-50"
            >
              {loading ? 'Loading...' : 'Load More'}
            </button>
          )}
          <p className="text-[9px] text-zinc-600 text-center">
            Photos provided by <span className="text-zinc-500">Pexels</span>
          </p>
        </>
      )}

      {!loading && photos.length === 0 && !error && (
        <p className="text-center text-xs text-zinc-500 py-4">
          Search for free stock images on Pexels
        </p>
      )}
    </div>
  )
}

function PexelsPhotoCard({ photo, onSelect }: { photo: PexelsPhoto; onSelect: () => void }) {
  const [hover, setHover] = useState(false)

  return (
    <div
      className="relative cursor-pointer overflow-hidden rounded border border-zinc-700 transition-all hover:border-violet-500 hover:ring-1 hover:ring-violet-500"
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <img
        src={photo.src.small}
        alt={photo.alt || 'Pexels photo'}
        className="h-20 w-full object-cover"
        loading="lazy"
      />
      {hover && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60">
          <span className="text-[10px] font-medium text-white">Use This</span>
          <span className="mt-0.5 text-[8px] text-zinc-300 px-1 text-center truncate w-full">
            by {photo.photographer}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Google Tab ──────────────────────────────────────────────────────────────

function GoogleTab({ defaultQuery }: { defaultQuery: string }) {
  const [query, setQuery] = useState(defaultQuery)

  const openGoogleImages = () => {
    const searchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
    window.open(searchUrl, '_blank')
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={e => { e.preventDefault(); openGoogleImages() }}
        className="flex gap-2"
      >
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search Google Images..."
          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-violet-500"
        />
        <button
          type="submit"
          disabled={!query.trim()}
          className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
      </form>

      <div className="rounded bg-zinc-800 p-3 text-center">
        <p className="text-xs text-zinc-400 mb-2">
          Google Images opens in your browser.
        </p>
        <p className="text-[10px] text-zinc-500 mb-3">
          Download the image you want, then use the <strong className="text-zinc-400">Upload</strong> tab to import it.
        </p>
        <button
          onClick={openGoogleImages}
          disabled={!query.trim()}
          className="inline-flex items-center gap-1.5 rounded bg-zinc-700 px-4 py-2 text-xs text-zinc-200 transition-colors hover:bg-zinc-600 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          Search Google Images
          <ExternalLink className="h-3 w-3 text-zinc-400" />
        </button>
      </div>
    </div>
  )
}

// ─── Remotion Tab ────────────────────────────────────────────────────────────

function RemotionTab({
  defaultDescription,
  shotId,
  onSelectFile,
  onRequest,
}: {
  defaultDescription: string
  shotId?: string
  onSelectFile: (path: string) => void
  onRequest?: (description: string) => void
}) {
  const [description, setDescription] = useState(defaultDescription)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmitRequest = () => {
    if (!description.trim()) return
    onRequest?.(description.trim())
    setSubmitted(true)
  }

  const handlePickRenderedFile = useCallback(async () => {
    const files = await window.electronAPI.showOpenFileDialog({
      title: 'Select Remotion Rendered Frame',
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    })
    if (files && files.length > 0) {
      onSelectFile(files[0])
    }
  }, [onSelectFile])

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded bg-gradient-to-r from-violet-500/10 to-blue-500/10 border border-violet-500/20 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Clapperboard className="h-4 w-4 text-violet-400" />
          <span className="text-xs font-medium text-violet-300">Remotion Motion Graphics</span>
        </div>
        <p className="text-[10px] text-zinc-400 leading-relaxed">
          Generate motion graphics with Remotion. Describe what you want below — Claude Code
          (via MCP) will write a Remotion composition, render it, and produce a frame or video.
        </p>
      </div>

      {/* Description input */}
      <div>
        <label className="text-[10px] font-medium text-zinc-500 mb-1 block">
          Motion Graphic Description {shotId && <span className="text-zinc-600">({shotId})</span>}
        </label>
        <textarea
          value={description}
          onChange={e => { setDescription(e.target.value); setSubmitted(false) }}
          placeholder="e.g. Title card with 'THE EMPIRE THAT DROWNED IN GOLD' in elegant serif font, gold text on black background with subtle particle effects..."
          rows={4}
          className="w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-violet-500"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSubmitRequest}
          disabled={!description.trim() || submitted}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded py-2 text-xs font-medium transition-colors ${
            submitted
              ? 'bg-green-600/20 text-green-400 border border-green-500/30'
              : 'bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-50'
          }`}
        >
          <Clapperboard className="h-3 w-3" />
          {submitted ? 'Request Sent to Claude Code' : 'Request via Claude Code'}
        </button>
      </div>

      {submitted && (
        <div className="rounded bg-zinc-800 p-2.5 text-[10px] text-zinc-400 leading-relaxed">
          The request has been saved to the factory status file. When Claude Code is connected
          via MCP, it will pick up the request and generate the Remotion composition.
          Once rendered, use <strong className="text-zinc-300">Import Rendered</strong> below to load the output.
        </div>
      )}

      <div className="border-t border-zinc-800 pt-3">
        <p className="text-[10px] text-zinc-500 mb-2">
          Already have a Remotion-rendered frame?
        </p>
        <button
          onClick={handlePickRenderedFile}
          className="flex w-full items-center justify-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-zinc-700"
        >
          <Upload className="h-3 w-3" />
          Import Rendered Frame
        </button>
      </div>
    </div>
  )
}
