import * as cp from "node:child_process"
import * as net from "node:net"
import { commandNeedsShell, formatExecutableNotFound, resolveExecutable, type ResolvedExecutable } from "./executableResolver"
import { executablePath, httpProxy } from "./settings"

export async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("failed to allocate port")))
        return
      }
      srv.close((err) => err ? reject(err) : resolve(addr.port))
    })
  })
}

export function spawnServer(dir: string, port: number) {
  const resolved = resolveExecutable({ configuredPath: executablePath() })
  const env: NodeJS.ProcessEnv = { ...resolved.env, OPENCODE_CALLER: "vscode" }
  const proxy = httpProxy()
  if (proxy) {
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
  }

  const proc = cp.spawn(resolved.command, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: dir,
    detached: process.platform !== "win32",
    env,
    shell: commandNeedsShell(resolved.command, process.platform),
  })
  ;(proc as cp.ChildProcess & { opencodeResolution?: ResolvedExecutable }).opencodeResolution = resolved
  return proc
}

export async function waitForHealth(url: string, timeout = 800, tries = 25) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)
    try {
      const res = await fetch(`${url}/global/health`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) {
        return
      }
    } catch {
      clearTimeout(timer)
    }
    await delay(400)
  }
  throw new Error("OpenCode health check timed out")
}

export function startupFailure(proc: cp.ChildProcess) {
  let done = false
  let onError: ((err: NodeJS.ErrnoException) => void) | undefined
  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined

  const cleanup = () => {
    if (onError) proc.off("error", onError)
    if (onExit) proc.off("exit", onExit)
  }

  const promise = new Promise<never>((_, reject) => {
    const fail = (message: string) => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(message))
    }
    onError = (err) => fail(formatSpawnError(err, (proc as cp.ChildProcess & { opencodeResolution?: ResolvedExecutable }).opencodeResolution))
    onExit = (code, signal) => fail(`server exited before ready (code=${code ?? "unknown"} signal=${signal ?? "none"})`)
    proc.once("error", onError)
    proc.once("exit", onExit)
  })

  return {
    promise,
    dispose() {
      done = true
      cleanup()
    },
  }
}

export async function stopServer(proc?: cp.ChildProcess) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return
  const done = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve())
    proc.once("close", () => resolve())
  })
  if (await kill(proc, "SIGINT", 600, done)) return
  if (await kill(proc, "SIGTERM", 400, done)) return
  await kill(proc, "SIGKILL", 400, done)
}

async function kill(proc: cp.ChildProcess, sig: NodeJS.Signals, ms: number, done: Promise<void>) {
  const pid = proc.pid
  if (!pid || proc.exitCode !== null || proc.signalCode !== null) return true
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = cp.spawn("taskkill", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
  } else {
    try {
      process.kill(-pid, sig)
    } catch {
      try { proc.kill(sig) } catch { return true }
    }
  }
  await Promise.race([done, delay(ms)])
  return proc.exitCode !== null || proc.signalCode !== null
}

function formatSpawnError(err: NodeJS.ErrnoException, resolved?: ResolvedExecutable) {
  const exe = executablePath()
  if (err.code === "ENOENT") return formatExecutableNotFound(exe, resolved?.diagnostics)
  if (err.code === "EACCES") return `failed to start opencode: command "${exe}" is not executable on the current host`
  return err.code ? `${err.message} (code=${err.code})` : err.message
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
