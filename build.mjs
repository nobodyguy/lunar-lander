import { build } from "esbuild";
import { minify } from "html-minifier-terser";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

// Bundle the ES module graph into one minified file; CSS is minified alongside.
await build({
  entryPoints: { index: "index.js", style: "style.css" },
  outdir: "dist",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  // Assets are referenced at runtime by relative path and copied as-is below.
  external: ["*.png", "*.jpg", "*.mp3"],
});

const html = await minify(await readFile("index.html", "utf8"), {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  removeScriptTypeAttributes: true,
  removeStyleLinkTypeAttributes: true,
  minifyCSS: true,
  minifyJS: true,
});
await writeFile("dist/index.html", html);

await cp("audio", "dist/audio", { recursive: true });
await cp("images", "dist/images", { recursive: true });
