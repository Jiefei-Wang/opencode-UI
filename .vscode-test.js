const { defineConfig } = require("@vscode/test-cli")

module.exports = defineConfig({
  files: ".vscode-test-dist/**/*.test.js",
  workspaceFolder: "./test-fixtures/workspace",
  mocha: {
    timeout: 30000,
  },
})
