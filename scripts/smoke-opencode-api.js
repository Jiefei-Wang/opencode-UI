const { spawn } = require("node:child_process")

const port = 17891
const opencode = `${process.env.APPDATA || `${process.env.USERPROFILE}\\AppData\\Roaming`}\\npm\\opencode.cmd`

const child = spawn(opencode, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
  cwd: process.cwd(),
  stdio: ["ignore", "pipe", "pipe"],
  shell: true,
  windowsHide: true,
})

child.stdout.on("data", (data) => process.stderr.write(data))
child.stderr.on("data", (data) => process.stderr.write(data))

const timeout = setTimeout(() => {
  console.error("OpenCode smoke test timed out")
  process.exitCode = 1
  void cleanup().finally(() => process.exit())
}, 30000)

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
}).finally(async () => {
  clearTimeout(timeout)
  await cleanup()
})

async function main() {
  await waitForHealth()
  const provider = await getJson("/provider")
  const providers = Array.isArray(provider) ? provider : provider.all ?? provider.data ?? []
  const modelCount = providers.flatMap((item) => Object.keys(item.models ?? {})).length
  console.log(`MODEL_COUNT=${modelCount}`)
  if (modelCount < 1) throw new Error("Expected OpenCode provider catalog to include at least one model")
}

async function waitForHealth() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: AbortSignal.timeout(500) })
      if (res.ok) return
    } catch {}
    await delay(300)
  }
  throw new Error("OpenCode server did not become healthy")
}

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(10000) })
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`)
  return await res.json()
}

async function cleanup() {
  if (!child.pid) return
  await new Promise((resolve) => {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true })
    killer.once("exit", resolve)
    killer.once("error", resolve)
  })
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
