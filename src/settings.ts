import * as vscode from "vscode"

export function config() {
  return vscode.workspace.getConfiguration("opencode")
}

export function executablePath() {
  return config().get<string>("executablePath")?.trim() || "opencode"
}

export function httpProxy() {
  return config().get<string>("httpProxy")?.trim() || ""
}

export function autoStart() {
  return config().get<string>("autoStart") || "onWorkspaceOpen"
}

export function defaultAgent() {
  return config().get<string>("defaultAgent")?.trim() || ""
}

export function defaultModel() {
  return config().get<string>("defaultModel")?.trim() || ""
}

export function showThinking() {
  return config().get<boolean>("showThinking") ?? true
}

export function richPanelEnabled() {
  return config().get<boolean>("richPanel.enabled") ?? true
}
