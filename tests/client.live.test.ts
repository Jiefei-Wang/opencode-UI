import assert from "node:assert/strict"
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { once } from "node:events"
import * as path from "node:path"
import test from "node:test"
import { createClient } from "../src/client"

const workspaceDir = process.cwd()

test("client talks to a real opencode server", { timeout: 60_000 }, async (t) => {
  if (process.env.OPENCODE_SKIP_LIVE_TESTS === "1") return

  const server = await startOpenCodeServer()
  t.after(async () => {
    await server.stop()
  })

  try {
    const client = await createClient(server.url, workspaceDir)

    const config = await step(t, "config.providers", () => client.config!.providers({ directory: workspaceDir }))
    assert.ok(Array.isArray(config.data?.providers), "config providers should return JSON providers")
    const connectedProviderIds = config.data!.providers!.map((provider) => provider.id)
    assert.ok(connectedProviderIds.includes("opencode"), "config providers should include the built-in opencode provider")
    assert.equal(connectedProviderIds.includes("requesty"), false, "config providers should not include broad catalog-only providers")

    const models = config.data!.providers!.flatMap((provider) => Object.keys(provider.models ?? {}).map((model) => `${provider.id}/${model}`))
    assert.ok(models.includes("opencode/big-pickle"), "config providers should expose usable models")

    const providerCatalog = await step(t, "provider.list", () => client.provider!.list({ directory: workspaceDir }))
    assert.ok(Array.isArray(providerCatalog.data?.all ?? providerCatalog.data?.providers), "provider catalog should return JSON providers")

    const agents = await step(t, "app.agents", () => client.app!.agents({ directory: workspaceDir }))
    assert.ok(Array.isArray(agents.data), "agents should return an array")

    const commands = await step(t, "command.list", () => client.command!.list({ directory: workspaceDir }))
    assert.ok(Array.isArray(commands.data), "commands should return an array")

    const beforeSessions = await step(t, "session.list", () => client.session.list({ directory: workspaceDir, roots: true }))
    assert.ok(Array.isArray(beforeSessions.data), "session list should return an array")

    const status = await step(t, "session.status", () => client.session.status({ directory: workspaceDir }))
    assert.equal(typeof status.data, "object", "session status should return an object")

    const created = await step(t, "session.create", () => client.session.create({ directory: workspaceDir, title: "OpenCode VS Code API smoke test" }))
    assert.ok(created.data?.id, "session create should return a session id")
    const sessionID = created.data!.id

    const messages = await step(t, "session.messages", () => client.session.messages({ sessionID, directory: workspaceDir }))
    assert.ok(Array.isArray(messages.data), "session messages should return an array")

    const todos = await step(t, "session.todo", () => client.session.todo({ sessionID, directory: workspaceDir }))
    assert.ok(Array.isArray(todos.data), "session todo should return an array")

    const diff = await step(t, "session.diff", () => client.session.diff({ sessionID, directory: workspaceDir }))
    assert.ok(Array.isArray(diff.data), "session diff should return an array")

    const permissions = await step(t, "permission.list", () => client.permission!.list({ directory: workspaceDir }))
    assert.ok(Array.isArray(permissions.data), "permissions should return an array")

    const questions = await step(t, "question.list", () => client.question!.list({ directory: workspaceDir }))
    assert.ok(Array.isArray(questions.data), "questions should return an array")

    await step(t, "session.delete", () => client.session.delete({ sessionID, directory: workspaceDir }))
  } finally {
    await server.stop()
  }
})

async function step<T>(t: Parameters<Parameters<typeof test>[2]>[0], name: string, run: () => Promise<T>) {
  t.diagnostic(`live opencode api: ${name}`)
  return await withTimeout(run(), 10_000, name)
}

async function withTimeout<T>(promise: Promise<T>, ms: number, name: string) {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function startOpenCodeServer() {
  const executable = opencodeExecutable()
  const port = 41_000 + Math.floor(Math.random() * 2_000)
  const command = process.platform === "win32" ? "cmd.exe" : executable
  const args = process.platform === "win32"
    ? ["/d", "/c", executable, "serve", "--hostname", "127.0.0.1", "--port", String(port)]
    : ["serve", "--hostname", "127.0.0.1", "--port", String(port)]
  const child = spawn(command, args, {
    cwd: workspaceDir,
    env: { ...process.env, OPENCODE_CALLER: "opencode-vscode-test" },
  })

  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => stdout += String(chunk))
  child.stderr.on("data", (chunk) => stderr += String(chunk))

  const url = await waitForServerUrl(child, () => stdout, () => stderr, port)
  return {
    url,
    stop: async () => {
      await stopProcess(child)
    },
  }
}

function opencodeExecutable() {
  if (process.env.OPENCODE_TEST_EXECUTABLE) return process.env.OPENCODE_TEST_EXECUTABLE
  if (process.platform !== "win32") return "opencode"
  const appData = process.env.APPDATA ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Roaming") : undefined)
  return appData ? path.join(appData, "npm", "opencode.cmd") : "opencode.cmd"
}

async function waitForServerUrl(child: ChildProcessWithoutNullStreams, stdout: () => string, stderr: () => string, port: number) {
  const deadline = Date.now() + 20_000
  let lastError: unknown
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`opencode serve exited with ${child.exitCode}\nstdout:\n${stdout()}\nstderr:\n${stderr()}`)
    const match = stdout().match(/https?:\/\/127\.0\.0\.1:\d+/)
    const url = match?.[0] ?? `http://127.0.0.1:${port}`
    try {
      const res = await fetchWithTimeout(`${url}/config/providers?directory=${encodeURIComponent(workspaceDir)}`, 1_000)
      if (res.ok) return url
    } catch (err) {
      lastError = err
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for opencode serve. Last error: ${String(lastError)}\nstdout:\n${stdout()}\nstderr:\n${stderr()}`)
}

async function fetchWithTimeout(url: string, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function stopProcess(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null) return
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => resolve()))
  } else {
    child.kill("SIGTERM")
  }
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])
  if (child.exitCode === null) child.kill("SIGKILL")
}
