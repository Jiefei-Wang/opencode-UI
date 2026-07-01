import assert from "node:assert/strict"
import test from "node:test"
import * as path from "node:path"
import { commandNeedsShell, findOnPath, formatExecutableNotFound, resolveExecutable, withAugmentedPath } from "../src/executableResolver"

test("resolveExecutable keeps an explicit configured path", () => {
  const resolved = resolveExecutable({ configuredPath: " C:\\tools\\opencode.exe ", env: { PATH: "C:\\bin" }, platform: "win32" })
  assert.equal(resolved.command, "C:\\tools\\opencode.exe")
})

test("resolveExecutable treats bare configured opencode as a PATH command", () => {
  const appData = "C:\\Users\\me\\AppData\\Roaming"
  const npmShim = path.join(appData, "npm", "opencode.cmd")
  const resolved = resolveExecutable({
    configuredPath: "opencode",
    env: { PATH: "C:\\Windows\\System32", APPDATA: appData, PATHEXT: ".CMD" },
    platform: "win32",
    exists: (file) => file === npmShim,
  })
  assert.equal(resolved.command, npmShim)
})

test("findOnPath resolves Windows .cmd shims", () => {
  const bin = "C:\\Users\\me\\AppData\\Roaming\\npm"
  const command = findOnPath("opencode", { PATH: bin, PATHEXT: ".COM;.EXE;.BAT;.CMD" }, "win32", (file) => file === path.join(bin, "opencode.cmd"))
  assert.equal(command, path.join(bin, "opencode.cmd"))
})

test("resolveExecutable prefers Windows PATHEXT shims over extensionless npm shim files", () => {
  const appData = "C:\\Users\\me\\AppData\\Roaming"
  const extensionless = path.join(appData, "npm", "opencode")
  const cmdShim = path.join(appData, "npm", "opencode.cmd")
  const resolved = resolveExecutable({
    configuredPath: "opencode",
    env: { PATH: path.join(appData, "npm"), APPDATA: appData, PATHEXT: ".COM;.EXE;.BAT;.CMD" },
    platform: "win32",
    exists: (file) => file === extensionless || file === cmdShim,
  })
  assert.equal(resolved.command, cmdShim)
})

test("resolveExecutable augments GUI extension host PATH with common Windows terminal package-manager bins", () => {
  const appData = "C:\\Users\\me\\AppData\\Roaming"
  const npmShim = path.join(appData, "npm", "opencode.cmd")
  const resolved = resolveExecutable({
    env: { PATH: "C:\\Windows\\System32", APPDATA: appData, PATHEXT: ".CMD" },
    platform: "win32",
    exists: (file) => file === npmShim,
  })
  assert.equal(resolved.command, npmShim)
})

test("resolveExecutable derives APPDATA npm shim path from USERPROFILE when APPDATA is missing", () => {
  const userProfile = "C:\\Users\\me"
  const npmShim = path.join(userProfile, "AppData", "Roaming", "npm", "opencode.cmd")
  const resolved = resolveExecutable({
    configuredPath: "opencode",
    env: { PATH: "C:\\Windows\\System32", USERPROFILE: userProfile, PATHEXT: ".CMD" },
    platform: "win32",
    exists: (file) => file === npmShim,
  })
  assert.equal(resolved.command, npmShim)
  assert.ok(resolved.diagnostics.extraPathEntries.includes(path.join(userProfile, "AppData", "Roaming", "npm")))
})

test("withAugmentedPath preserves existing PATH entries and appends Unix user bins", () => {
  const env = withAugmentedPath({ PATH: "/usr/bin", HOME: "/home/me" }, "linux")
  const entries = env.PATH?.split(":") ?? []
  assert.deepEqual(entries.slice(0, 4), ["/usr/bin", "/home/me/.bun/bin", "/home/me/.local/bin", "/home/me/.npm-global/bin"])
})

test("findOnPath returns undefined when the command cannot be found", () => {
  assert.equal(findOnPath("opencode", { PATH: "C:\\missing", PATHEXT: ".CMD" }, "win32", () => false), undefined)
})

test("formatExecutableNotFound explains the VS Code PATH mismatch fix", () => {
  const message = formatExecutableNotFound("opencode", resolveExecutable({ env: { PATH: "C:\\missing" }, platform: "win32", exists: () => false }).diagnostics)
  assert.match(message, /opencode\.executablePath/)
  assert.match(message, /OpenCode-specific candidates/)
  assert.match(message, /restart VS Code/)
})

test("commandNeedsShell detects Windows command shims", () => {
  assert.equal(commandNeedsShell("C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.cmd", "win32"), true)
  assert.equal(commandNeedsShell("C:\\tools\\opencode.exe", "win32"), false)
  assert.equal(commandNeedsShell("/usr/local/bin/opencode", "linux"), false)
})
