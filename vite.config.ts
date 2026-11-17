import { defineConfig, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL(".", import.meta.url))
const firefox = process.env.BROWSER_TARGET === "firefox"
const outDir = firefox ? "dist-firefox" : "dist"

function firefoxManifest(): Plugin {
  return {
    name: "browse-firefox-manifest",
    closeBundle() {
      const manifest = JSON.parse(readFileSync(path.join(root, "public", "manifest.json"), "utf8")) as Record<string, unknown>
      Object.assign(manifest, JSON.parse(readFileSync(path.join(root, "manifest.firefox.json"), "utf8")))
      delete manifest.key
      delete manifest.minimum_chrome_version
      writeFileSync(path.join(root, outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
    },
  }
}

// The extension is loaded unpacked from dist/. The service worker must keep a stable name for the
// manifest; everything else is content-hashed.
export default defineConfig(({ mode }) => ({
  // Identifies this build in the relay's log and status, so install can tell whether a reload took effect. The CLI's
  // build passes its own stamp so it can record it next to the copied extension.
  // OPENCODE_BROWSER_TEST_HOOKS=1 builds the stress harness's hooks in (src/background/index.ts); without it they're
  // compiled out, so a release never carries them.
  define: {
    __OPENCODE_BROWSER_BUILD__: JSON.stringify(process.env.OPENCODE_BROWSER_BUILD ?? new Date().toISOString()),
    __OPENCODE_BROWSER_TEST_HOOKS__: JSON.stringify(process.env.OPENCODE_BROWSER_TEST_HOOKS === "1"),
  },
  // The onboarding and settings pages are Solid, with @opencode/ui; everything they use is bundled (MV3 runs no
  // remote code).
  plugins: [solid(), ...(firefox ? [firefoxManifest()] : [])],
  root,
  publicDir: "public",
  base: "./",
  build: {
    outDir,
    emptyOutDir: true,
    target: firefox ? "firefox139" : "chrome130",
    minify: mode !== "development",
    sourcemap: mode === "development" ? "inline" : false,
    modulePreload: false,
    rolldownOptions: {
      input: {
        welcome: fileURLToPath(new URL("./welcome.html", import.meta.url)),
        onboarding: fileURLToPath(new URL("./onboarding.html", import.meta.url)),
        settings: fileURLToPath(new URL("./settings.html", import.meta.url)),
        background: fileURLToPath(new URL("./src/background/index.ts", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
      },
    },
  },
}))
