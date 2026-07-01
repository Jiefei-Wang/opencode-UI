export type RuntimeState = "stopped" | "starting" | "ready" | "busy" | "error" | "stopping"

export type SessionInfo = {
  id: string
  directory?: string
  title?: string
  time?: {
    created?: number
    updated?: number
    archived?: number
  }
}

export type SessionStatus = { type: "idle" } | { type: "busy" } | { type: "retry"; attempt?: number; message?: string; next?: number }

export type Todo = {
  content: string
  status: string
  priority: string
}

export type FileDiff = {
  file: string
  before?: string
  after?: string
  additions?: number
  deletions?: number
  status?: "added" | "deleted" | "modified"
}

export type AgentInfo = {
  name: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  model?: {
    providerID: string
    modelID: string
  }
  variant?: string
}

export type CommandInfo = {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
  hints?: string[]
  agent?: string
  model?: string
}

export type ProviderInfo = {
  id: string
  name?: string
  models?: Record<string, { id: string; name?: string }>
}

export type PermissionReply = "once" | "always" | "reject"

export type PermissionRequest = {
  id: string
  sessionID: string
  permission: string
  patterns?: string[]
  metadata?: Record<string, unknown>
}

export type QuestionOption = {
  label: string
  description?: string
}

export type QuestionInfo = {
  question: string
  header?: string
  options?: QuestionOption[]
  multiple?: boolean
  custom?: boolean
}

export type QuestionRequest = {
  id: string
  sessionID: string
  questions: QuestionInfo[]
}

export type MessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time?: { created?: number; completed?: number }
  agent?: string
  model?: { providerID: string; modelID: string }
}

export type MessagePart = {
  id?: string
  sessionID?: string
  messageID?: string
  type: string
  text?: string
  tool?: string
  state?: {
    status?: string
    title?: string
    input?: Record<string, unknown>
    output?: string
    error?: string
  }
  [key: string]: unknown
}

export type SessionMessage = {
  info: MessageInfo
  parts: MessagePart[]
}

export type SessionEvent = {
  type: string
  properties?: any
}

export type SkillInfo = {
  id: string
  name: string
  description?: string
  source: "workspace" | "user" | "extension" | "mcp" | "unknown"
  triggerText: string
  hints: string[]
}

export type ModelPick = {
  providerID: string
  modelID: string
  label: string
}

export type OpenCodeClient = {
  session: {
    list(input?: Record<string, unknown>): Promise<{ data?: SessionInfo[] }>
    create(input?: Record<string, unknown>): Promise<{ data?: SessionInfo }>
    delete(input: Record<string, unknown>): Promise<{ data?: boolean }>
    messages(input: Record<string, unknown>): Promise<{ data?: SessionMessage[] }>
    promptAsync(input: Record<string, unknown>): Promise<{ data?: void }>
    command(input: Record<string, unknown>): Promise<{ data?: void }>
    abort(input: Record<string, unknown>): Promise<{ data?: boolean }>
    todo(input: Record<string, unknown>): Promise<{ data?: Todo[] }>
    diff(input: Record<string, unknown>): Promise<{ data?: FileDiff[] }>
    status(input?: Record<string, unknown>): Promise<{ data?: Record<string, SessionStatus> }>
  }
  app?: {
    agents(input?: Record<string, unknown>): Promise<{ data?: AgentInfo[] }>
  }
  command?: {
    list(input?: Record<string, unknown>): Promise<{ data?: CommandInfo[] }>
  }
  provider?: {
    list(input?: Record<string, unknown>): Promise<{ data?: { all?: ProviderInfo[]; providers?: ProviderInfo[] } }>
  }
  config?: {
    providers(input?: Record<string, unknown>): Promise<{ data?: { providers?: ProviderInfo[] } }>
  }
  permission?: {
    list(input?: Record<string, unknown>): Promise<{ data?: PermissionRequest[] }>
    reply(input: Record<string, unknown>): Promise<{ data?: void }>
  }
  question?: {
    list(input?: Record<string, unknown>): Promise<{ data?: QuestionRequest[] }>
    reply(input: Record<string, unknown>): Promise<{ data?: void }>
    reject(input: Record<string, unknown>): Promise<{ data?: void }>
  }
  event?: {
    subscribe(input?: Record<string, unknown>, options?: { signal?: AbortSignal; onSseError?: (error: unknown) => void }): Promise<{ stream: AsyncIterable<SessionEvent> }>
  }
}
