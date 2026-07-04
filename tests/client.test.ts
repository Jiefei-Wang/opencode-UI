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
        if (parsed?.delivery !== "queue" && parsed?.delivery !== "steer") {
          res.statusCode = 400
          res.end(JSON.stringify({ error: "invalid delivery" }))
          return
        }
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
    assert.equal(prompt?.body.delivery, "queue")
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("client canonicalizes Windows drive-letter directories in session list queries", async () => {
  const requests: string[] = []
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? "")
    req.resume()
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify([]))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const addr = server.address()
    assert.equal(typeof addr, "object")
    const client = await createClient(`http://127.0.0.1:${addr!.port}`, "g:\\My Drive\\slides\\lecture 7")
    await client.session.list({ roots: true })

    assert.match(requests[0], /directory=G%3A%5CMy\+Drive%5Cslides%5Clecture\+7/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("client parses CRLF-delimited SSE events", async () => {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/api/event")) {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.end('data: {"type":"session.status","properties":{"status":{"type":"idle"}}}\r\n\r\n')
      return
    }
    res.statusCode = 404
    res.end("not found")
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const addr = server.address()
    assert.equal(typeof addr, "object")
    const client = await createClient(`http://127.0.0.1:${addr!.port}`, "C:\\workspace")
    const sub = await client.event!.subscribe({ directory: "C:\\workspace" })
    const events = []
    for await (const event of sub.stream) events.push(event)

    assert.equal(events.length, 1)
    assert.equal(events[0].type, "session.status")
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("client does not retry mutating fallback endpoints after server errors", async () => {
  const requests: string[] = []
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    req.resume()
    res.statusCode = 500
    res.end("boom")
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const addr = server.address()
    assert.equal(typeof addr, "object")
    const client = await createClient(`http://127.0.0.1:${addr!.port}`, "C:\\workspace")

    await assert.rejects(() => client.session.create({ directory: "C:\\workspace" }), /\/session failed: 500 boom/)
    assert.deepEqual(requests, ["POST /session"])
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("client prefers the full provider catalog endpoint for models", async () => {
  const requests: string[] = []
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    req.resume()
    res.setHeader("content-type", "application/json")
    if (req.method === "GET" && req.url?.startsWith("/provider")) {
      res.end(JSON.stringify({ all: [{ id: "provider-a", name: "Provider A", models: { "model-a": { id: "model-a", name: "Model A" } } }] }))
      return
    }
    if (req.method === "GET" && req.url?.startsWith("/api/provider")) {
      res.end(JSON.stringify({ data: [{ id: "configured-only", name: "Configured Only" }] }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: "not found" }))
  })

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const addr = server.address()
    assert.equal(typeof addr, "object")
    const client = await createClient(`http://127.0.0.1:${addr!.port}`, "C:\\workspace")

    const result = await client.provider!.list({ directory: "C:\\workspace" })
    assert.equal(result.data?.all?.[0]?.models?.["model-a"]?.id, "model-a")
    assert.equal(requests[0].startsWith("GET /provider"), true)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
