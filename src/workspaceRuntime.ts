import type { RuntimeState } from "./opencodeTypes"

export type MinimalWorkspaceFolder = {
  name: string
  uri: {
    fsPath: string
    toString(): string
  }
}

export type StoppedWorkspaceRuntime = {
  workspaceId: string
  folder: MinimalWorkspaceFolder
  dir: string
  name: string
  state: RuntimeState
}

export function workspaceId(folder: MinimalWorkspaceFolder) {
  return folder.uri.toString()
}

export function normalizeWorkspacePath(value: string) {
  return /^[a-z]:[\\/]/.test(value) ? value[0].toUpperCase() + value.slice(1) : value
}

export function createStoppedRuntime(folder: MinimalWorkspaceFolder): StoppedWorkspaceRuntime {
  return {
    workspaceId: workspaceId(folder),
    folder,
    dir: normalizeWorkspacePath(folder.uri.fsPath),
    name: folder.name,
    state: "stopped",
  }
}
