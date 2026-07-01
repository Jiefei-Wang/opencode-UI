import type { OpenCodeClient } from "./opencodeTypes"

export async function createClient(url: string, dir: string): Promise<OpenCodeClient> {
  return {
    session: {
      list: (input) => getFirst(url, ["/api/session", "/session"], withDirectory(dir, input)),
      create: (input) => postFirst(url, ["/api/session", "/session"], toCreateBody(dir, input)),
      delete: (input) => postFirst(url, [`/api/session/${sessionID(input)}/delete`, `/session/${sessionID(input)}/delete`], stripSession(withDirectory(dir, input))),
      messages: (input) => getFirst(url, [`/api/session/${sessionID(input)}/message`, `/session/${sessionID(input)}/message`], stripSession(withDirectory(dir, input))),
      promptAsync: (input) => postFirst(url, [`/api/session/${sessionID(input)}/prompt`, `/session/${sessionID(input)}/prompt_async`], toPromptBody(dir, input)),
      command: (input) => postFirst(url, [`/api/session/${sessionID(input)}/command`, `/session/${sessionID(input)}/command`], stripSession(withDirectory(dir, input))),
      abort: (input) => postFirst(url, [`/api/session/${sessionID(input)}/abort`, `/session/${sessionID(input)}/abort`], stripSession(withDirectory(dir, input))),
      todo: (input) => getFirst(url, [`/api/session/${sessionID(input)}/todo`, `/session/${sessionID(input)}/todo`], stripSession(withDirectory(dir, input))),
      diff: (input) => getFirst(url, [`/api/session/${sessionID(input)}/diff`, `/session/${sessionID(input)}/diff`], stripSession(withDirectory(dir, input))),
      status: (input) => getFirst(url, ["/api/session/status", "/session/status"], withDirectory(dir, input)),
    },
    app: {
      agents: (input) => getFirst(url, ["/api/agent", "/agent", "/api/app/agents", "/app/agents"], withDirectory(dir, input)),
    },
    command: {
      list: (input) => getFirst(url, ["/api/command", "/command"], withDirectory(dir, input)),
    },
    provider: {
      list: (input) => getFirst(url, ["/api/provider", "/provider"], withDirectory(dir, input)),
    },
    config: {
      providers: (input) => getFirst(url, ["/api/config/providers", "/config/providers"], withDirectory(dir, input)),
    },
    permission: {
      list: (input) => getFirst(url, ["/api/permission", "/permission"], withDirectory(dir, input)),
      reply: (input) => postFirst(url, [`/api/permission/${requestID(input)}`, `/permission/${requestID(input)}`], stripRequest(withDirectory(dir, input))),
    },
    question: {
      list: (input) => getFirst(url, ["/api/question", "/question"], withDirectory(dir, input)),
      reply: (input) => postFirst(url, [`/api/question/${requestID(input)}`, `/question/${requestID(input)}`], stripRequest(withDirectory(dir, input))),
      reject: (input) => postFirst(url, [`/api/question/${requestID(input)}/reject`, `/question/${requestID(input)}/reject`], stripRequest(withDirectory(dir, input))),
    },
    event: {
      subscribe: (input, options) => subscribeFirst(url, ["/api/event", "/event"], withDirectory(dir, input), options),
    },
  }
}

function withDirectory(dir: string, input?: Record<string, unknown>) {
  return { directory: dir, ...(input ?? {}) }
}

async function post<T = unknown>(baseUrl: string, path: string, body?: Record<string, unknown>): Promise<{ data?: T }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })

  if (!res.ok) {
    throw new HttpError(path, res.status, await res.text())
  }

  if (res.status === 204) return {}
  const text = await res.text()
  return normalizeResponse<T>(text)
}

async function get<T = unknown>(baseUrl: string, path: string, query?: Record<string, unknown>): Promise<{ data?: T }> {
  const qs = toQuery(query)
  const res = await fetch(`${baseUrl}${path}${qs}`, { method: "GET" })

  if (!res.ok) {
    throw new HttpError(path, res.status, await res.text())
  }

  if (res.status === 204) return {}
  const text = await res.text()
  return normalizeResponse<T>(text)
}

function normalizeResponse<T>(text: string): { data?: T } {
  if (!text) return {}
  const value = JSON.parse(text)
  if (value && typeof value === "object" && "data" in value) return value
  return { data: value }
}

async function getFirst<T = unknown>(baseUrl: string, paths: string[], query?: Record<string, unknown>) {
  return await first(paths, (path) => get<T>(baseUrl, path, query))
}

async function postFirst<T = unknown>(baseUrl: string, paths: string[], body?: Record<string, unknown>) {
  return await first(paths, (path) => post<T>(baseUrl, path, body))
}

async function first<T>(items: string[], run: (item: string) => Promise<T>) {
  let last: unknown
  for (const item of items) {
    try {
      return await run(item)
    } catch (err) {
      last = err
      if (!isFallbackStatus(err)) throw err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

class HttpError extends Error {
  constructor(path: string, readonly status: number, body: string) {
    super(`${path} failed: ${status} ${body}`)
  }
}

function isFallbackStatus(err: unknown) {
  return err instanceof HttpError && (err.status === 404 || err.status === 405)
}

async function subscribeFirst(baseUrl: string, paths: string[], query?: Record<string, unknown>, options?: { signal?: AbortSignal; onSseError?: (error: unknown) => void }) {
  const stream = sseFirst(baseUrl, paths, query ?? {}, options)
  return { stream }
}

async function* sseFirst(baseUrl: string, paths: string[], query: Record<string, unknown>, options?: { signal?: AbortSignal; onSseError?: (error: unknown) => void }) {
  let last: unknown
  for (const path of paths) {
    try {
      yield* sse(`${baseUrl}${path}${toQuery(query)}`, options)
      return
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function* sse(url: string, options?: { signal?: AbortSignal; onSseError?: (error: unknown) => void }) {
  const res = await fetch(url, {
    method: "GET",
    headers: { accept: "text/event-stream" },
    signal: options?.signal,
  })

  if (!res.ok || !res.body) {
    throw new HttpError(url, res.status, await res.text())
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return
      buffer += decoder.decode(chunk.value, { stream: true })
      let split = eventBoundary(buffer)
      while (split) {
        const raw = buffer.slice(0, split.index)
        buffer = buffer.slice(split.index + split[0].length)
        const data = raw.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data)
          } catch (err) {
            options?.onSseError?.(err)
          }
        }
        split = eventBoundary(buffer)
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function eventBoundary(buffer: string): RegExpExecArray | null {
  return /\r?\n\r?\n/.exec(buffer)
}

function toQuery(input?: Record<string, unknown>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined || value === null) continue
    if (typeof value === "object") continue
    params.set(key, String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ""
}

function sessionID(input?: Record<string, unknown>) {
  const value = input?.sessionID ?? input?.id
  if (!value || typeof value !== "string") throw new Error("sessionID is required")
  return encodeURIComponent(value)
}

function requestID(input?: Record<string, unknown>) {
  const value = input?.requestID ?? input?.id
  if (!value || typeof value !== "string") throw new Error("requestID is required")
  return encodeURIComponent(value)
}

function stripSession(input?: Record<string, unknown>) {
  const { sessionID: _sessionID, id: _id, ...rest } = input ?? {}
  return rest
}

function stripRequest(input?: Record<string, unknown>) {
  const { requestID: _requestID, id: _id, ...rest } = input ?? {}
  return rest
}

function toCreateBody(dir: string, input?: Record<string, unknown>) {
  return { location: dir, directory: dir, ...(input ?? {}) }
}

function toPromptBody(dir: string, input?: Record<string, unknown>) {
  const stripped = stripSession(withDirectory(dir, input))
  const parts = Array.isArray(stripped.parts) ? stripped.parts as any[] : []
  const text = parts.filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n")
  return {
    ...stripped,
    delivery: "queue",
    prompt: text ? { text } : undefined,
  }
}
