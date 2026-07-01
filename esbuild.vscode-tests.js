const esbuild = require("esbuild")

esbuild.build({
  entryPoints: ["tests/vscode/extensionHost.test.ts"],
  bundle: true,
  outdir: ".vscode-test-dist",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
