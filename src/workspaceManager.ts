import * as cp from "node:child_process"
import * as vscode from "vscode"
import { createClient } from "./client"
import type { OpenCodeClient, RuntimeState } from "./opencodeTypes"
import { freePort, spawnServer, startupFailure, stopServer, waitForHealth } from "./server"
import { createStoppedRuntime, normalizeWorkspacePath, workspaceId } from "./workspaceRuntime"

export type WorkspaceRuntime = {
  workspaceId: string
  folder: vscode.WorkspaceFolder
  dir: string
  name: string
  state: RuntimeState
  port?: number
  url?: string
  proc?: cp.ChildProcess
  client?: OpenCodeClient
  error?: string
}

export class WorkspaceManager implements vscode.Disposable {
  private runtimes = new Map<string, WorkspaceRuntime>()
  private ops = new Map<string, Promise<unknown>>()
  private emitter = new vscode.EventEmitter<void>()
  readonly onDidChange = this.emitter.event

  constructor(private out: vscode.OutputChannel) {}

  list() {
    return [...this.runtimes.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  get(idOrDir?: string) {
    if (!idOrDir) return this.list()[0]
    return this.runtimes.get(idOrDir) ?? this.list().find((rt) => rt.dir === idOrDir || rt.folder.uri.toString() === idOrDir)
  }

  async ensure(folder?: vscode.WorkspaceFolder) {
    const target = folder ?? await this.pickWorkspaceFolder()
    if (!target) throw new Error("OpenCode needs an open workspace folder")
    const id = workspaceId(target)
    return await this.serialize(id, () => this.ensureNow(target))
  }

  async restart(id?: string) {
    const rt = this.get(id)
    const folder = rt?.folder ?? await this.pickWorkspaceFolder()
    if (!folder) return undefined
    const key = workspaceId(folder)
    return await this.serialize(key, async () => {
      await this.removeNow(key)
      return await this.ensureNow(folder)
    })
  }

  async sync(folders: readonly vscode.WorkspaceFolder[]) {
    const next = new Set(folders.map(workspaceId))
    let changed = false
    for (const folder of folders) {
      const id = workspaceId(folder)
      if (this.runtimes.has(id)) continue
      this.runtimes.set(id, createStoppedRuntime(folder) as WorkspaceRuntime)
      changed = true
    }
    await Promise.all([...this.runtimes.keys()].filter((id) => !next.has(id)).map((id) => this.remove(id)))
    if (changed) this.fire()
  }

  async remove(id: string) {
    await this.serialize(id, () => this.removeNow(id))
  }

  async shutdown() {
    await Promise.all([...this.runtimes.keys()].map((id) => this.remove(id)))
  }

  dispose() {
    this.emitter.dispose()
    void this.shutdown()
  }

  private async ensureNow(folder: vscode.WorkspaceFolder) {
    const id = workspaceId(folder)
    const existing = this.runtimes.get(id)
    if (existing?.state === "ready" || existing?.state === "starting") return existing
    if (existing?.proc) await stopServer(existing.proc)

    const port = await freePort()
    const url = `http://127.0.0.1:${port}`
    const dir = normalizeWorkspacePath(folder.uri.fsPath)
    const proc = spawnServer(dir, port)
    const resolution = (proc as cp.ChildProcess & { opencodeResolution?: { command: string; diagnostics?: unknown } }).opencodeResolution
    const startup = startupFailure(proc)
    const rt: WorkspaceRuntime = {
      workspaceId: id,
      folder,
      dir,
      name: folder.name,
      state: "starting",
      port,
      url,
      proc,
    }
    this.runtimes.set(id, rt)
    this.bind(rt)
    this.log(rt, `starting server on ${url} cwd=${rt.dir} host=${vscode.env.remoteName || "local"}`)
    if (resolution) this.log(rt, `opencode command=${resolution.command} resolution=${safeJson(resolution.diagnostics)}`)
    this.fire()

    try {
      await Promise.race([waitForHealth(url), startup.promise])
      startup.dispose()
      rt.client = await createClient(url, rt.dir)
      rt.state = "ready"
      rt.error = undefined
      this.log(rt, "server ready")
    } catch (err) {
      startup.dispose()
      await stopServer(proc)
      rt.state = "error"
      rt.client = undefined
      rt.error = text(err)
      this.log(rt, `server failed: ${rt.error}`)
    }
    this.fire()
    return rt
  }

  private async removeNow(id: string) {
    const rt = this.runtimes.get(id)
    if (!rt) return
    rt.state = "stopping"
    rt.client = undefined
    this.fire()
    await stopServer(rt.proc)
    if (this.runtimes.get(id) === rt) this.runtimes.delete(id)
    this.log(rt, "server stopped")
    this.fire()
  }

  private bind(rt: WorkspaceRuntime) {
    rt.proc?.stdout?.on("data", (buf) => this.log(rt, String(buf).trimEnd()))
    rt.proc?.stderr?.on("data", (buf) => {
      const text = String(buf).trimEnd()
      this.log(rt, text)
      const message = runtimeErrorMessage(text)
      if (message) {
        rt.error = message
        this.fire()
      }
    })
    rt.proc?.on("exit", (code, signal) => {
      const cur = this.runtimes.get(rt.workspaceId)
      if (!cur || cur.proc !== rt.proc || cur.state === "stopping") return
      cur.state = "stopped"
      cur.client = undefined
      cur.error = code === 0 ? undefined : `exit code=${code ?? "unknown"} signal=${signal ?? "none"}`
      this.log(cur, `server exited ${cur.error ?? "cleanly"}`)
      this.fire()
    })
    rt.proc?.on("error", (err) => {
      const cur = this.runtimes.get(rt.workspaceId)
      if (!cur) return
      cur.state = "error"
      cur.client = undefined
      cur.error = text(err)
      this.log(cur, `process error: ${cur.error}`)
      this.fire()
    })
  }

  private async pickWorkspaceFolder() {
    const folders = vscode.workspace.workspaceFolders ?? []
    if (folders.length <= 1) return folders[0]
    return await vscode.window.showWorkspaceFolderPick({ placeHolder: "Select workspace for OpenCode" })
  }

  private async serialize<T>(id: string, run: () => Promise<T>) {
    const prev = this.ops.get(id) ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(run)
    this.ops.set(id, next)
    try { return await next } finally { if (this.ops.get(id) === next) this.ops.delete(id) }
  }

  private log(rt: WorkspaceRuntime, msg: string) {
    for (const line of msg.split(/\r?\n/).filter(Boolean)) {
      this.out.appendLine(`[${rt.name}] ${line}`)
    }
  }

  private fire() {
    this.emitter.fire()
  }
}

function text(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function runtimeErrorMessage(value: string) {
  if (!/\b(ERROR|Error|InvalidRequestError|Provider request failed|Unauthorized|invalid_api_key)\b/.test(value)) return undefined
  const apiKey = value.match(/Unauthorized: No API key provided[^"\n]*/)?.[0]
  if (apiKey) return apiKey
  const provider = value.match(/Provider request failed[^\n]*/)?.[0]
  if (provider) return provider
  const first = value.split(/\r?\n/).find((line) => line.trim())?.trim()
  return first ? first.slice(0, 500) : undefined
}
