import * as vscode from "vscode"

export type PromptContextPriority = "low" | "high" | "very-high"

export type PromptContextItem = {
  id: string
  source: "live" | "pinned" | "attachment"
  kind: "active-file" | "selection" | "file" | "folder" | "reference"
  priority: PromptContextPriority
  title: string
  detail?: string
  removable?: boolean
  payload: Record<string, unknown>
}

export type PromptContextSnapshot = {
  items: PromptContextItem[]
  canAddActiveFile: boolean
  canAddSelection: boolean
  canAddFile: boolean
  canAddFolder: boolean
  workspaceName?: string
  workspacePath?: string
}

const promptContextMaxChars = 24000
const fileContextMaxChars = 12000
const folderTreeFileLimit = 60
const folderSnippetLimit = 6
const folderSnippetMaxChars = 2200
const ignoredFolderNames = new Set([".git", ".hg", ".svn", "node_modules", "dist", "out", "build", "target", ".vscode"])

export function collectEditorContext(editor = vscode.window.activeTextEditor): PromptContextSnapshot {
  if (!editor) {
    return { items: [], canAddActiveFile: false, canAddSelection: false, canAddFile: false, canAddFolder: false }
  }

  const document = editor.document
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
  const relativePath = workspaceFolder ? vscode.workspace.asRelativePath(document.uri, false) : document.fileName || document.uri.toString()
  const cursor = editor.selection.active
  const visibleRange = editor.visibleRanges[0]
  const nearby = sliceDocumentLines(document, Math.max(0, cursor.line - 8), Math.min(document.lineCount - 1, cursor.line + 8))
  const fileDiagnostics = collectDiagnostics(document.uri)
  const items: PromptContextItem[] = []

  items.push({
    id: contextId("live", "active-file", document.uri.toString()),
    source: "live",
    kind: "active-file",
    priority: "low",
    title: pathLabel(relativePath),
    detail: formatSingleLine(cursor.line),
    removable: false,
    payload: {
      path: relativePath,
      uri: document.uri.toString(),
      languageId: document.languageId,
      cursor: { line: cursor.line, character: cursor.character },
      visibleRange: visibleRange ? rangeToObject(visibleRange) : undefined,
      nearbyCode: nearby,
      diagnostics: fileDiagnostics,
    },
  })

  const selection = editor.selection
  if (!selection.isEmpty) {
    const text = document.getText(selection)
    const selectionDiagnostics = collectDiagnostics(document.uri, selection)
    const selectionContext = sliceDocumentLines(document, Math.max(0, selection.start.line - 4), Math.min(document.lineCount - 1, selection.end.line + 4))
    items.push({
      id: contextId("live", "selection", `${document.uri.toString()}:${selection.start.line}:${selection.start.character}:${selection.end.line}:${selection.end.character}`),
      source: "live",
      kind: "selection",
      priority: "high",
      title: pathLabel(relativePath),
      detail: formatLineSpan(selection.start.line, selection.end.line),
      removable: false,
      payload: {
        path: relativePath,
        uri: document.uri.toString(),
        languageId: document.languageId,
        selection: rangeToObject(selection),
        text,
        surroundingCode: selectionContext,
        diagnostics: selectionDiagnostics,
      },
    })
  }

  return {
    items,
    canAddActiveFile: true,
    canAddSelection: !editor.selection.isEmpty,
    canAddFile: Boolean(vscode.workspace.workspaceFolders?.length),
    canAddFolder: Boolean(vscode.workspace.workspaceFolders?.length),
    workspaceName: workspaceFolder?.name,
    workspacePath: workspaceFolder?.uri.fsPath,
  }
}

export async function collectPinnedFileContexts(uris: readonly vscode.Uri[]) {
  const items: PromptContextItem[] = []
  for (const uri of uris) {
    items.push(await collectFileContext(uri, true))
  }
  return items
}

export async function collectPinnedFolderContexts(uris: readonly vscode.Uri[]) {
  const items: PromptContextItem[] = []
  for (const uri of uris) {
    items.push(await collectFolderContext(uri, true))
  }
  return items
}

export async function collectPromptReferenceContexts(references: readonly vscode.ChatPromptReference[]) {
  const items: PromptContextItem[] = []
  for (const reference of references) {
    const item = await collectPromptReferenceContext(reference)
    if (item) items.push(item)
  }
  return items
}

export function composePromptText(prompt: string, contextItems: readonly PromptContextItem[]) {
  const trimmedPrompt = prompt.trim()
  const items = dedupeAndSortContextItems(contextItems)
  if (!items.length) return trimmedPrompt

  const sections: string[] = ["Context:"]
  let total = sections[0].length
  for (const item of items) {
    const rendered = renderContextItem(item)
    if (!rendered) continue
    if (total + rendered.length > promptContextMaxChars) {
      sections.push("- Context truncated to keep the prompt compact.")
      break
    }
    sections.push(rendered)
    total += rendered.length
  }
  sections.push("")
  sections.push("User request:")
  sections.push(trimmedPrompt)
  return sections.join("\n")
}

export async function collectFileContext(uri: vscode.Uri, pinned = false): Promise<PromptContextItem> {
  const document = await vscode.workspace.openTextDocument(uri)
  const text = document.getText()
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
  const relativePath = workspaceFolder ? vscode.workspace.asRelativePath(uri, false) : document.fileName || uri.toString()
  const chunks = splitTextIntoChunks(text, fileContextMaxChars)

  return {
    id: contextId(pinned ? "pinned" : "live", "file", `${uri.toString()}:${text.length}`),
    source: pinned ? "pinned" : "live",
    kind: "file",
    priority: pinned ? "very-high" : "low",
    title: pathLabel(relativePath),
    detail: `${document.languageId}${text.length > fileContextMaxChars ? `, truncated to ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}` : ""}`,
    removable: pinned,
    payload: {
      path: relativePath,
      uri: uri.toString(),
      languageId: document.languageId,
      size: text.length,
      truncated: text.length > fileContextMaxChars,
      chunks,
    },
  }
}

export async function collectFolderContext(uri: vscode.Uri, pinned = false): Promise<PromptContextItem> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
  const folderName = workspaceFolder?.name ?? uri.fsPath.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "Folder"
  const files = await walkFolder(uri, folderTreeFileLimit * 4)
  const tree = files.slice(0, folderTreeFileLimit).map((file) => toRelativePath(uri, file))
  const importantFiles = rankFolderFiles(files).slice(0, folderSnippetLimit)
  const snippets: Array<{ path: string; languageId: string; text: string; truncated: boolean }> = []

  for (const file of importantFiles) {
    try {
      const document = await vscode.workspace.openTextDocument(file)
      const text = document.getText()
      snippets.push({
        path: toRelativePath(uri, file),
        languageId: document.languageId,
        text: text.slice(0, folderSnippetMaxChars),
        truncated: text.length > folderSnippetMaxChars,
      })
    } catch {
      continue
    }
  }

  return {
    id: contextId(pinned ? "pinned" : "live", "folder", uri.toString()),
    source: pinned ? "pinned" : "live",
    kind: "folder",
    priority: pinned ? "very-high" : "low",
    title: folderName,
    detail: `${files.length} file${files.length === 1 ? "" : "s"}, ${snippets.length} snippet${snippets.length === 1 ? "" : "s"}`,
    removable: pinned,
    payload: {
      path: workspaceFolder ? workspaceFolder.uri.fsPath : uri.fsPath,
      uri: uri.toString(),
      tree,
      files: files.slice(0, folderTreeFileLimit).map((file) => toRelativePath(uri, file)),
      snippets,
      ignoredDirectories: [...ignoredFolderNames],
      retrievedFiles: snippets.map((snippet) => snippet.path),
    },
  }
}

function dedupeAndSortContextItems(items: readonly PromptContextItem[]) {
  const order: Record<PromptContextPriority, number> = { "very-high": 0, high: 1, low: 2 }
  const sorted = [...items].sort((left, right) => order[left.priority] - order[right.priority])
  const seen = new Set<string>()
  const result: PromptContextItem[] = []
  for (const item of sorted) {
    const key = contextKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function renderContextItem(item: PromptContextItem) {
  const lines = [
    `- ${item.title} [${item.priority}]`,
    item.detail ? `  - ${item.detail}` : undefined,
  ].filter(Boolean) as string[]

  for (const [key, value] of Object.entries(item.payload)) {
    if (value === undefined) continue
    lines.push(...renderPayloadEntry(key, value))
  }

  return lines.join("\n")
}

function renderPayloadEntry(key: string, value: unknown) {
  if (Array.isArray(value)) {
    if (!value.length) return [`  - ${key}: []`]
    if (value.every((entry) => typeof entry === "string")) return [`  - ${key}:`, ...value.map((entry) => `    - ${entry}`)]
    return [`  - ${key}:`, ...value.map((entry) => `    - ${stringifyEntry(entry)}`)]
  }
  if (typeof value === "object" && value) {
    if (isRangeLike(value)) return [`  - ${key}: ${formatRange(value as { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } })}`]
    return [`  - ${key}: ${stringifyEntry(value)}`]
  }
  if (typeof value === "string" && value) {
    if (key === "text" || key === "nearbyCode" || key === "surroundingCode" || key === "chunks") {
      return [`  - ${key}:`, "```", value, "```"]
    }
    return [`  - ${key}: ${value}`]
  }
  if (typeof value === "number" || typeof value === "boolean") return [`  - ${key}: ${String(value)}`]
  return []
}

function stringifyEntry(value: unknown) {
  return JSON.stringify(value, undefined, 2)
}

function formatRange(range: { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }) {
  const start = range.start ? `${(range.start.line ?? 0) + 1}:${(range.start.character ?? 0) + 1}` : "?"
  const end = range.end ? `${(range.end.line ?? 0) + 1}:${(range.end.character ?? 0) + 1}` : "?"
  return `${start}-${end}`
}

function formatSingleLine(line: number) {
  return `Line ${line + 1}`
}

function formatLineSpan(startLine: number, endLine: number) {
  return startLine === endLine ? formatSingleLine(startLine) : `Lines ${startLine + 1}-${endLine + 1}`
}

function isRangeLike(value: object) {
  return "start" in value && "end" in value
}

function collectDiagnostics(uri: vscode.Uri, range?: vscode.Range) {
  const diagnostics = vscode.languages.getDiagnostics(uri)
  const filtered = range ? diagnostics.filter((diagnostic) => diagnostic.range.intersection(range)) : diagnostics
  return filtered.slice(0, 20).map((diagnostic) => ({
    severity: severityName(diagnostic.severity),
    message: diagnostic.message,
    range: rangeToObject(diagnostic.range),
    source: diagnostic.source,
  }))
}

async function collectPromptReferenceContext(reference: vscode.ChatPromptReference): Promise<PromptContextItem | undefined> {
  const value = reference.value
  if (value instanceof vscode.Uri) {
    try {
      const stat = await vscode.workspace.fs.stat(value)
      if (stat.type === vscode.FileType.Directory) return await collectFolderContext(value, true)
      return await collectFileContext(value, true)
    } catch {
      const item: PromptContextItem = {
        id: contextId("attachment", "reference", value.toString()),
        source: "attachment",
        kind: "reference",
        priority: "very-high",
        title: pathLabel(value.fsPath || value.path || value.toString()),
        detail: value.toString(),
        removable: false,
        payload: { uri: value.toString(), modelDescription: reference.modelDescription, promptRange: reference.range },
      }
      return item
    }
  }
  if (value instanceof vscode.Location) {
    const document = await vscode.workspace.openTextDocument(value.uri)
    const text = document.getText(value.range)
    const relativePath = vscode.workspace.asRelativePath(value.uri, false)
    const item: PromptContextItem = {
      id: contextId("attachment", "reference", `${value.uri.toString()}:${formatRange(value.range)}`),
      source: "attachment",
      kind: "reference",
      priority: "very-high",
      title: pathLabel(relativePath),
      detail: formatLineSpan(value.range.start.line, value.range.end.line),
      removable: false,
      payload: {
        path: relativePath,
        uri: value.uri.toString(),
        range: rangeToObject(value.range),
        text,
        languageId: document.languageId,
        modelDescription: reference.modelDescription,
        promptRange: reference.range,
      },
    }
    return item
  }
  if (typeof value === "string") {
    const item: PromptContextItem = {
      id: contextId("attachment", "reference", value),
      source: "attachment",
      kind: "reference",
      priority: "very-high",
      title: "Attached text",
      detail: reference.modelDescription || `${value.length} characters`,
      removable: false,
      payload: { text: value, modelDescription: reference.modelDescription, promptRange: reference.range },
    }
    return item
  }
  return undefined
}

async function walkFolder(root: vscode.Uri, limit: number) {
  const files: vscode.Uri[] = []
  await visit(root)
  return files

  async function visit(current: vscode.Uri) {
    if (files.length >= limit) return
    let entries: [string, vscode.FileType][]
    try {
      entries = await vscode.workspace.fs.readDirectory(current)
    } catch {
      return
    }
    for (const [name, type] of entries) {
      if (files.length >= limit) return
      if (type === vscode.FileType.Directory && ignoredFolderNames.has(name)) continue
      const child = vscode.Uri.joinPath(current, name)
      if (type === vscode.FileType.Directory) await visit(child)
      else if (type === vscode.FileType.File) files.push(child)
    }
  }
}

function rankFolderFiles(files: readonly vscode.Uri[]) {
  return [...files].sort((left, right) => folderFileRank(left) - folderFileRank(right) || left.fsPath.localeCompare(right.fsPath))
}

function folderFileRank(uri: vscode.Uri) {
  const name = uri.path.split("/").pop()?.toLowerCase() ?? ""
  if (["package.json", "tsconfig.json", "jsconfig.json", "readme.md", "readme"].includes(name)) return 0
  if (name.endsWith(".ts") || name.endsWith(".tsx") || name.endsWith(".js") || name.endsWith(".jsx") || name.endsWith(".md")) return 1
  if (name.endsWith(".json") || name.endsWith(".yml") || name.endsWith(".yaml") || name.endsWith(".toml")) return 2
  return 3
}

function toRelativePath(root: vscode.Uri, uri: vscode.Uri) {
  const rootPath = normalizeSlashes(root.fsPath).replace(/\/+$/, "")
  const filePath = normalizeSlashes(uri.fsPath)
  if (filePath.toLowerCase().startsWith(rootPath.toLowerCase() + "/")) return filePath.slice(rootPath.length + 1)
  return vscode.workspace.asRelativePath(uri, false)
}

function splitTextIntoChunks(text: string, chunkSize: number) {
  if (text.length <= chunkSize) return [text]
  const chunks: string[] = []
  for (let index = 0; index < text.length; index += chunkSize) chunks.push(text.slice(index, index + chunkSize))
  return chunks
}

function sliceDocumentLines(document: vscode.TextDocument, startLine: number, endLine: number) {
  if (document.lineCount === 0) return ""
  const start = Math.max(0, startLine)
  const end = Math.min(document.lineCount - 1, endLine)
  const range = new vscode.Range(new vscode.Position(start, 0), document.lineAt(end).range.end)
  return document.getText(range)
}

function rangeToObject(range: vscode.Range) {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}

function severityName(severity: vscode.DiagnosticSeverity) {
  return vscode.DiagnosticSeverity[severity].toLowerCase()
}

function contextId(source: PromptContextItem["source"], kind: PromptContextItem["kind"], value: string) {
  return `${source}:${kind}:${value}`
}

function contextKey(item: PromptContextItem) {
  const payload = item.payload as Record<string, unknown>
  const range = payload.range ? JSON.stringify(payload.range) : payload.selection ? JSON.stringify(payload.selection) : ""
  const text = typeof payload.text === "string" ? payload.text.slice(0, 200) : ""
  const uri = typeof payload.uri === "string" ? payload.uri : ""
  const path = typeof payload.path === "string" ? payload.path : ""
  return [item.kind, uri, path, range, text].join("|")
}

function pathLabel(value: string) {
  return value.split(/[\\/]/).filter(Boolean).slice(-1)[0] || value
}

function normalizeSlashes(value: string) {
  return value.replace(/\\/g, "/")
}