import type { AiProvider } from '../types/factory'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMCompletionParams {
  system?: string
  messages: LLMMessage[]
  maxTokens: number
  temperature?: number
}

export interface LLMCompletionResult {
  text: string
}

export interface LLMService {
  complete(params: LLMCompletionParams): Promise<LLMCompletionResult>
  stream(params: LLMCompletionParams): AsyncGenerator<string>
  testConnection(): Promise<boolean>
  getProviderName(): string
}

export interface LLMSettings {
  aiProvider: AiProvider
  anthropicApiKey: string
  anthropicModel: string
  proxyUrl: string
  proxyToken: string
  proxyModel: string
}

// ─── Anthropic Direct Provider ──────────────────────────────────────────────

class AnthropicProvider implements LLMService {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  getProviderName(): string {
    return `Anthropic (${this.model})`
  }

  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'content-type': 'application/json',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.7,
        system: params.system,
        messages: params.messages.map(m => ({ role: m.role, content: m.content })),
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${err}`)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text || ''
    return { text }
  }

  async *stream(params: LLMCompletionParams): AsyncGenerator<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.7,
        system: params.system,
        messages: params.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield parsed.delta.text
            }
          } catch {
            // skip non-JSON lines
          }
        }
      }
    }
  }
}

// ─── Local Proxy Provider (OpenAI-compatible) ───────────────────────────────

class ProxyProvider implements LLMService {
  constructor(
    private proxyUrl: string,
    private token: string,
    private model: string,
  ) {}

  getProviderName(): string {
    return `Proxy (${this.model})`
  }

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.proxyUrl.replace(/\/$/, '')}/v1/models`
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`
      const response = await fetch(url, { headers })
      return response.ok
    } catch {
      return false
    }
  }

  async complete(params: LLMCompletionParams): Promise<LLMCompletionResult> {
    const url = `${this.proxyUrl.replace(/\/$/, '')}/v1/chat/completions`
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const messages: Array<{ role: string; content: string }> = []
    if (params.system) {
      messages.push({ role: 'system', content: params.system })
    }
    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content })
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.7,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Proxy API error: ${response.status} ${err}`)
    }

    const data = await response.json()
    const text = data.choices?.[0]?.message?.content || ''
    return { text }
  }

  async *stream(params: LLMCompletionParams): AsyncGenerator<string> {
    const url = `${this.proxyUrl.replace(/\/$/, '')}/v1/chat/completions`
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`

    const messages: Array<{ role: string; content: string }> = []
    if (params.system) {
      messages.push({ role: 'system', content: params.system })
    }
    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content })
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: params.maxTokens,
        temperature: params.temperature ?? 0.7,
        stream: true,
      }),
    })

    if (!response.ok) {
      throw new Error(`Proxy API error: ${response.status}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) yield delta
          } catch {
            // skip
          }
        }
      }
    }
  }
}

// ─── Factory Function ───────────────────────────────────────────────────────

/** Create an LLM service based on the configured provider. */
export function createLLMService(settings: LLMSettings): LLMService {
  switch (settings.aiProvider) {
    case 'anthropic':
      return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel)
    case 'local':
      return new ProxyProvider(settings.proxyUrl, settings.proxyToken, settings.proxyModel)
    case 'hybrid':
      // Hybrid uses Anthropic for the main provider (quality tier)
      // In the future this could route by tier, but for Phase A we default to Anthropic
      if (settings.anthropicApiKey) {
        return new AnthropicProvider(settings.anthropicApiKey, settings.anthropicModel)
      }
      return new ProxyProvider(settings.proxyUrl, settings.proxyToken, settings.proxyModel)
  }
}
