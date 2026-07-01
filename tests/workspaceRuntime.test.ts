import assert from "node:assert/strict"
import test from "node:test"
import { createStoppedRuntime, workspaceId } from "../src/workspaceRuntime"

test("createStoppedRuntime seeds an opened VS Code folder before the server starts", () => {
  const folder = {
    name: "devel",
    uri: {
      fsPath: "C:\\Users\\jiewang\\Desktop\\devel",
      toString: () => "file:///c%3A/Users/jiewang/Desktop/devel",
    },
  }

  assert.deepEqual(createStoppedRuntime(folder), {
    workspaceId: "file:///c%3A/Users/jiewang/Desktop/devel",
    folder,
    dir: "C:\\Users\\jiewang\\Desktop\\devel",
    name: "devel",
    state: "stopped",
  })
})

test("workspaceId uses VS Code's URI string, not the display name or filesystem path", () => {
  const folder = {
    name: "same-name-can-repeat",
    uri: {
      fsPath: "C:\\repo",
      toString: () => "file:///c%3A/repo",
    },
  }

  assert.equal(workspaceId(folder), "file:///c%3A/repo")
})
