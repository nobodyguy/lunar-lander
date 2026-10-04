import { build } from "esbuild";
import { minify } from "html-minifier-terser";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";

// Shared on social sites or unused by the game, so not worth caching offline
const NOT_PRECACHED = [
  "images/oembed.png",
  "images/favicon-540x540.png",
  "images/surfacerepeat.jpg",
];

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

// The service worker is only registered in the built game, so `npm start`
// always serves the files being edited
const registerServiceWorker = `<script>
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
</script>`;
const html = await minify(
  (await readFile("index.html", "utf8")).replace(
    "</body>",
    `${registerServiceWorker}</body>`
  ),
  {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true,
    minifyCSS: true,
    minifyJS: true,
  }
);
await writeFile("dist/index.html", html);

await cp("audio", "dist/audio", { recursive: true });
await cp("images", "dist/images", { recursive: true });
await cp("manifest.webmanifest", "dist/manifest.webmanifest");

// Precache everything built so far, versioned by its contents so any change
// installs a fresh cache
const files = (await readdir("dist", { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) =>
    `${entry.parentPath}/${entry.name}`.replace(/\\/g, "/").replace(/^dist\//, "")
  )
  .filter((file) => !NOT_PRECACHED.includes(file))
  .sort();
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(await readFile(`dist/${file}`));
}

await build({
  entryPoints: ["sw.js"],
  outfile: "dist/sw.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  define: {
    VERSION: JSON.stringify(hash.digest("hex").slice(0, 12)),
    PRECACHE: JSON.stringify(files),
  },
});
