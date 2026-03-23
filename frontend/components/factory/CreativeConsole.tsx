import { useRef, useEffect, useState } from 'react'
import { X, Send, Sparkles, Check, Trash2 } from 'lucide-react'
import type { ChatMessage } from '../../types/factory'

interface CreativeConsoleProps {
  messages: ChatMessage[]
  onSend: (content: string) => void
  onApplyPreview: (messageId: string, previewIndex: number) => void
  isStreaming: boolean
  onClose: () => void
}

export function CreativeConsole({
  messages,
  onSend,
  onApplyPreview,
  isStreaming,
  onClose,
}: CreativeConsoleProps) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="w-96 flex-shrink-0 flex flex-col border-l border-zinc-800 bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-zinc-100">Creative Console</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          {messages.map(msg => (
            <div key={msg.id}>
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'ml-auto bg-violet-600 text-white'
                    : 'mr-auto bg-zinc-800 text-zinc-200'
                }`}
              >
                <p className="whitespace-pre-wrap">{msg.content}</p>
              </div>

              {/* Shot preview cards */}
              {msg.shotPreviews && msg.shotPreviews.length > 0 && (
                <div className="mt-2 flex flex-col gap-2">
                  {msg.shotPreviews.map((preview, idx) => (
                    <div
                      key={`${msg.id}-preview-${idx}`}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 p-3"
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-zinc-200">
                          {preview.shot.id}
                        </span>
                        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {preview.action}
                        </span>
                        <span className="text-xs text-zinc-500">{preview.shot.scene}</span>
                      </div>
                      <p className="mb-2 line-clamp-2 text-xs text-zinc-400">
                        {preview.shot.description}
                      </p>
                      {!preview.applied ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => onApplyPreview(msg.id, idx)}
                            className="flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-violet-500"
                          >
                            <Check className="h-3 w-3" />
                            Apply to Manifest
                          </button>
                          <button
                            className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-700"
                          >
                            <Trash2 className="h-3 w-3" />
                            Discard
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-green-400">Applied</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {isStreaming && (
            <div className="mr-auto flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-2">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '0.15s' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" style={{ animationDelay: '0.3s' }} />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area */}
      <div className="border-t border-zinc-800 p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe shots, refine prompts..."
            rows={2}
            className="flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="self-end rounded-lg bg-violet-600 p-2.5 text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
