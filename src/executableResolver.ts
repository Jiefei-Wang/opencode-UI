import * as fs from "node:fs"
import * as path from "node:path"

export type ResolveExecutableOptions = {
  configuredPath?: string
  commandName?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  exists?: (file: string) => boolean
  access?: (file: string) => boolean
}

export type ResolvedExecutable = {
  command: string
  env: NodeJS.ProcessEnv
  diagnostics: ExecutableDiagnostics
}

export type ExecutableDiagnostics = {
  configuredPath: string
  commandName: string
  pathKey: string
  pathEntries: string[]
  extraPathEntries: string[]
  preferredCandidates: Array<{ file: string; exists: boolean }>
  candidates: string[]
  found?: string
}

export function resolveExecutable(options: ResolveExecutableOptions = {}): ResolvedExecutable {
  const platform = options.platform ?? process.platform
  const originalEnv = options.env ?? process.env
  const env = withAugmentedPath(originalEnv, platform)
  const configured = options.configuredPath?.trim()
  const commandName = configured || options.commandName?.trim() || "opencode"
  const diagnostics = executableDiagnostics(commandName, configured ?? "", originalEnv, env, platform, options.exists ?? fs.existsSync, options.access)
  if (configured && hasPathSeparator(configured)) return { command: configured, env, diagnostics }

  return { command: diagnostics.found ?? commandName, env, diagnostics }
}

export function withAugmentedPath(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const next = { ...env }
  const pathKey = pathEnvKey(next)
  const existing = splitPath(next[pathKey], platform)
  const extra = platform === "win32" ? windowsExecutableDirs(next) : unixExecutableDirs(next)
  next[pathKey] = unique([...existing, ...extra], platform).join(pathDelimiter(platform))
  return next
}

export function findOnPath(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (file: string) => boolean = fs.existsSync, access?: (file: string) => boolean) {
  if (hasPathSeparator(command)) return isUsable(command, exists, access) ? command : undefined

  const pathKey = pathEnvKey(env)
  const extensions = executableExtensions(command, env, platform)
  for (const dir of splitPath(env[pathKey], platform)) {
    for (const ext of extensions) {
      const candidate = joinPath(platform, dir, `${command}${ext}`)
      if (isUsable(candidate, exists, access)) return candidate
    }
  }
  return undefined
}

export function executableDiagnostics(command: string, configuredPath: string, originalEnv: NodeJS.ProcessEnv, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (file: string) => boolean = fs.existsSync, access?: (file: string) => boolean): ExecutableDiagnostics {
  const pathKey = pathEnvKey(env)
  const extraPathEntries = platform === "win32" ? windowsExecutableDirs(originalEnv) : unixExecutableDirs(originalEnv)
  const candidates = executableCandidates(command, env, platform)
  return {
    configuredPath,
    commandName: command,
    pathKey,
    pathEntries: splitPath(env[pathKey], platform),
    extraPathEntries,
    preferredCandidates: preferredExecutableCandidates(command, originalEnv, platform).map((file) => ({ file, exists: isUsable(file, exists, access) })),
    candidates,
    found: candidates.find((candidate) => isUsable(candidate, exists, access)),
  }
}

export function formatExecutableNotFound(command: string, diagnostics?: ExecutableDiagnostics) {
  const lines = [`failed to start opencode: command "${command}" was not found on the current host PATH.`]
  if (diagnostics) {
    lines.push(`configured opencode.executablePath: ${diagnostics.configuredPath || "<empty/default>"}`)
    lines.push(`PATH variable used: ${diagnostics.pathKey}`)
    lines.push(`PATH entries (${diagnostics.pathEntries.length}): ${diagnostics.pathEntries.join(" | ") || "<none>"}`)
    lines.push(`extra OpenCode search dirs: ${diagnostics.extraPathEntries.join(" | ") || "<none>"}`)
    lines.push(`OpenCode-specific candidates: ${diagnostics.preferredCandidates.map((candidate) => `${candidate.file}=${candidate.exists}`).join(" | ") || "<none>"}`)
    lines.push(`first candidates checked: ${diagnostics.candidates.slice(0, 12).join(" | ") || "<none>"}`)
  }
  lines.push("Set opencode.executablePath to the full path, or restart VS Code after updating PATH.")
  return lines.join("\n")
}

export function commandNeedsShell(command: string, platform: NodeJS.Platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(command)
}

function executableCandidates(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (hasPathSeparator(command)) return [command]
  const pathKey = pathEnvKey(env)
  const extensions = executableExtensions(command, env, platform)
  const preferred = preferredExecutableCandidates(command, env, platform)
  const all = splitPath(env[pathKey], platform).flatMap((dir) => extensions.map((ext) => joinPath(platform, dir, `${command}${ext}`)))
  return unique([...preferred, ...all], platform)
}

function executableExtensions(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (platform !== "win32" || path.extname(command)) return [""]
  const pathext = env.PATHEXT || ".COM;.EXE;.BAT;.CMD"
  return [...pathext.split(";").filter(Boolean).map((ext) => ext.toLowerCase()), ""]
}

function preferredExecutableCandidates(command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (hasPathSeparator(command)) return [command]
  const dirs = platform === "win32" ? windowsExecutableDirs(env) : unixExecutableDirs(env)
  return dirs.flatMap((dir) => executableExtensions(command, env, platform).map((ext) => joinPath(platform, dir, `${command}${ext}`)))
}

function windowsExecutableDirs(env: NodeJS.ProcessEnv) {
  const appData = env.APPDATA || (env.USERPROFILE ? path.win32.join(env.USERPROFILE, "AppData", "Roaming") : undefined)
  const localAppData = env.LOCALAPPDATA || (env.USERPROFILE ? path.win32.join(env.USERPROFILE, "AppData", "Local") : undefined)
  return [
    appData ? path.win32.join(appData, "npm") : undefined,
    localAppData ? path.win32.join(localAppData, "pnpm") : undefined,
    env.USERPROFILE ? path.win32.join(env.USERPROFILE, ".bun", "bin") : undefined,
    env.USERPROFILE ? path.win32.join(env.USERPROFILE, ".local", "bin") : undefined,
  ].filter((dir): dir is string => Boolean(dir))
}

function unixExecutableDirs(env: NodeJS.ProcessEnv) {
  return [
    env.HOME ? path.posix.join(env.HOME, ".bun", "bin") : undefined,
    env.HOME ? path.posix.join(env.HOME, ".local", "bin") : undefined,
    env.HOME ? path.posix.join(env.HOME, ".npm-global", "bin") : undefined,
  ].filter((dir): dir is string => Boolean(dir))
}

function pathEnvKey(env: NodeJS.ProcessEnv) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
}

function splitPath(value: string | undefined, platform: NodeJS.Platform) {
  return (value ?? "").split(pathDelimiter(platform)).map((item) => item.trim()).filter(Boolean)
}

function unique(items: string[], platform: NodeJS.Platform) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = platform === "win32" ? item.toLowerCase() : item
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function pathDelimiter(platform: NodeJS.Platform) {
  return platform === "win32" ? ";" : ":"
}

function joinPath(platform: NodeJS.Platform, ...parts: string[]) {
  return platform === "win32" ? path.win32.join(...parts) : path.posix.join(...parts)
}

function hasPathSeparator(command: string) {
  return command.includes("/") || command.includes("\\")
}

function isUsable(file: string, exists: (file: string) => boolean, access?: (file: string) => boolean) {
  if (!exists(file)) return false
  if (!access) return true
  return access(file)
}
