"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// tests/vscode/extensionHost.test.ts
var assert = __toESM(require("node:assert/strict"));
var vscode = __toESM(require("vscode"));
suite("OpenCode extension host", () => {
  test("activates and registers core commands", async () => {
    const ext = vscode.extensions.getExtension("local.opencode-vscode");
    assert.ok(ext, "extension should be discoverable by publisher/name");
    await ext.activate();
    const commands2 = await vscode.commands.getCommands(true);
    for (const command of [
      "opencode.openPanel",
      "opencode.newSession",
      "opencode.abort",
      "opencode.checkEnvironment"
    ]) {
      assert.ok(commands2.includes(command), `${command} should be registered`);
    }
  });
  test("uses workspace-open autostart as the contributed default", () => {
    assert.equal(vscode.workspace.getConfiguration("opencode").get("autoStart"), "onWorkspaceOpen");
  });
  test("focuses the contributed side panel command", async () => {
    await vscode.commands.executeCommand("opencode.openPanel");
  });
});
