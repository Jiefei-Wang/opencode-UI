const esbuild = require("esbuild")

esbuild.build({
  entryPoints: ["tests/executableResolver.test.ts", "tests/workspaceRuntime.test.ts", "tests/client.test.ts"],
  bundle: true,
  outdir: ".test-dist",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
