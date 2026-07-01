const esbuild = require("esbuild")

const production = process.argv.includes("--production")
const watch = process.argv.includes("--watch")

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node20",
  nodePaths: process.env.NODE_PATH ? process.env.NODE_PATH.split(require("path").delimiter) : [],
  sourcemap: !production,
  minify: production,
}

async function main() {
  if (watch) {
    const ctx = await esbuild.context(config)
    await ctx.watch()
    console.log("watching")
    return
  }

  await esbuild.build(config)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
