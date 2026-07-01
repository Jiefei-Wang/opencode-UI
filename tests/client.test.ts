import assert from "node:assert/strict"
import * as http from "node:http"
import test from "node:test"
import { createClient } from "../src/client"

test("client supports direct OpenCode session object responses and sends prompt end-to-end", async () => {
  const requests: Array<{ method?: string; url?: string; body: any }> = []
  const server = http.createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => body += chunk)
    req.on("end", () => {
      const parsed = body ? JSON.parse(body) : undefined
      requests.push({ method: req.method, url: req.url, body: parsed })
      res.setHeader("content-type", "application/json")
      if (req.method === "POST" && req.url === "/api/session") {
        res.end(JSON.stringify({ id: "session-1", title: "direct response" }))
        return
      }
      if (req.method === "POST" && req.url === "/api/session/session-1/prompt") {
        res.end(JSON.stringify({ ok: true }))
        return
      }
      if (req.method === "GET" && req.url?.startsWith("/api/session/status")) {
        res.end(JSON.stringify({ data: {} }))
        return
      }
      if (req.method === "GET" && req.url?.startsWith("/api/session")) {
        res.end(JSON.stringify([{ id: "session-1", title: "direct response" }]))
        return
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: "not found" }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const addr = server.address()
    assert.equal(typeof addr, "object")
    const client = await createClient(`http://127.0.0.1:${addr!.port}`, "C:\\workspace")
    const created = await client.session.create({ directory: "C:\\workspace" })
    assert.equal(created.data?.id, "session-1")
    await client.session.promptAsync({ sessionID: "session-1", directory: "C:\\workspace", parts: [{ type: "text", text: "hi" }] })

    const prompt = requests.find((request) => request.url === "/api/session/session-1/prompt")
    assert.equal(prompt?.body.prompt.text, "hi")
    assert.equal(prompt?.body.delivery, "async")
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
