import { afterAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { installChrome } from "./chrome-stub"

const stub = installChrome()
const { isFirefox } = await import("../src/shared/browser")
const { browserBrand, browseNotification, relayCapabilities, tabGroupsAvailable } = await import(
  "../src/background/agent-relay/wire"
)
const { ToolbarNotice } = await import("../src/background/toolbar-notice")
const { DebuggerHub } = await import("../src/background/debugger-hub")
const { pageRead, sendCommand } = await import("../src/background/firefox-cdp")

const json = (file: string) => JSON.parse(readFileSync(path.join(import.meta.dir, "..", file), "utf8")) as Record<string, any>
const chromeManifest = json("public/manifest.json")
const firefoxManifest = json("manifest.firefox.json")

const runtime = stub.chrome.runtime as unknown as { getURL: (file: string) => string }
const chromeGetURL = runtime.getURL

const setFirefox = (firefox: boolean) => {
  runtime.getURL = firefox
    ? (file: string) => `moz-extension://0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b/${file.replace(/^\//, "")}`
    : chromeGetURL
}

async function whileFirefox(run: () => Promise<void>) {
  setFirefox(true)
  try {
    await run()
  } finally {
    setFirefox(false)
  }
}

afterAll(() => {
  setFirefox(false)
  stub.state.notifications.clear()
})

const merged = () => {
  const manifest = { ...chromeManifest, ...firefoxManifest } as Record<string, any>
  delete manifest.key
  delete manifest.minimum_chrome_version
  return manifest
}

describe("Firefox manifest", () => {
  test("runs the background as an event page, not a service worker", () => {
    expect(merged().background).toEqual({ scripts: ["background.js"], type: "module" })
    expect(merged().background.service_worker).toBeUndefined()
  })

  test("keeps the relay reachable over plain ws on loopback", () => {
    expect(merged().content_security_policy.extension_pages).not.toContain("upgrade-insecure-requests")
  })

  test("drops Chrome-only keys and the debugger permission", () => {
    expect(merged().key).toBeUndefined()
    expect(merged().minimum_chrome_version).toBeUndefined()
    expect(merged().permissions).not.toContain("debugger")
  })

  test("keeps the APIs the add-on uses", () => {
    for (const permission of ["tabs", "tabGroups", "storage", "sessions", "alarms", "webNavigation", "scripting", "notifications"])
      expect(merged().permissions).toContain(permission)
    expect(merged().host_permissions).toEqual(["<all_urls>"])
    expect(merged().options_ui).toEqual(chromeManifest.options_ui)
  })

  test("gives the add-on a stable id and a minimum Firefox version", () => {
    expect(merged().browser_specific_settings.gecko).toEqual({ id: "browse@opencode.ai", strict_min_version: "139.0" })
  })
})

describe("Firefox detection", () => {
  test("Chromium builds keep their brand, capabilities and tab groups", () => {
    expect(isFirefox()).toBe(false)
    expect(browserBrand()).toBe("Chrome")
    expect(relayCapabilities()).toEqual(["tab-release"])
    expect(tabGroupsAvailable()).toBe(true)
  })

  test("a moz-extension origin is Firefox, with its own capability", () => {
    setFirefox(true)
    try {
      expect(isFirefox()).toBe(true)
      expect(browserBrand()).toBe("Firefox")
      expect(relayCapabilities()).toEqual(["tab-release", "native-page"])
    } finally {
      setFirefox(false)
    }
  })
})

describe("notifications", () => {
  test("Chrome gets its own extras and the detail apart", () => {
    expect(browseNotification({ iconUrl: "icon.png", title: "browse", message: "Sign in", detail: "At the bank" })).toEqual({
      type: "basic",
      iconUrl: "icon.png",
      title: "browse",
      message: "Sign in",
      contextMessage: "At the bank",
      requireInteraction: true,
      priority: 2,
    })
  })

  test("Firefox gets only the options it accepts", () => {
    setFirefox(true)
    try {
      expect(browseNotification({ iconUrl: "icon.png", title: "browse", message: "Sign in", detail: "At the bank" })).toEqual({
        type: "basic",
        iconUrl: "icon.png",
        title: "browse",
        message: "Sign in\nAt the bank",
      })
    } finally {
      setFirefox(false)
    }
  })
})

describe("Firefox-native page driver", () => {
  const page = async () => (await stub.chrome.windows.create({ url: "https://example.com/" })).tabs[0]!.id

  test("attaches a lent tab with no chrome.debugger", () =>
    whileFirefox(async () => {
      const tabId = await page()
      expect(DebuggerHub.available()).toBe(true)
      await expect(DebuggerHub.attach(tabId)).resolves.toBeUndefined()
      expect(DebuggerHub.attachedTabs()).toContain(tabId)
      await DebuggerHub.detach(tabId)
      expect(DebuggerHub.attachedTabs()).not.toContain(tabId)
    }))

  test("answers every command a lend sends", () =>
    whileFirefox(async () => {
      const tabId = await page()
      expect(await sendCommand(tabId, "Page.enable", {})).toEqual({})
      expect(await sendCommand(tabId, "Emulation.setFocusEmulationEnabled", { enabled: false })).toEqual({})
      const info = (await sendCommand(tabId, "Target.getTargetInfo", {})).targetInfo as unknown as {
        targetId: string
        url: string
        type: string
      }
      expect(info.targetId).toBe(`tab-${tabId}`)
      expect(info.url).toBe("https://example.com/")
      expect(info.type).toBe("page")
    }))

  test("reads a page through scripting", () =>
    whileFirefox(async () => {
      const tabId = await page()
      const chrome = stub.chrome as unknown as { scripting?: unknown }
      chrome.scripting = {
        executeScript: async () => [
          { result: { url: "https://example.com/", title: "Example Domain", text: "Example Domain\nThis domain is for use in illustrative examples." } },
        ],
      }
      const read = await pageRead(tabId, false)
      expect(read.title).toBe("Example Domain")
      expect(String(read.text)).toContain("illustrative examples")
      expect(read.tabId).toBe(tabId)
    }))
})

describe("pages an agent can't use", () => {
  const tab = async (url: string) => (await stub.chrome.windows.create({ url })).tabs[0]!.id

  test("Chromium internals and the Web Store are refused", async () => {
    for (const url of ["chrome://extensions", "https://chromewebstore.google.com/detail/browse/abc"]) {
      stub.state.notifications.clear()
      expect(await ToolbarNotice.unavailable(await tab(url))).toBe("page")
    }
  })

  test("Firefox internals and other add-ons are refused, about:blank is not", () =>
    whileFirefox(async () => {
      for (const url of ["about:addons", "moz-extension://11111111-2222-3333-4444-555555555555/popup.html"]) {
        stub.state.notifications.clear()
        expect(await ToolbarNotice.unavailable(await tab(url))).toBe("page")
      }
      stub.state.notifications.clear()
      expect(await ToolbarNotice.unavailable(await tab("about:blank"))).toBeUndefined()
    }))

  test("a file page without the Firefox file permission says how to turn it on", () =>
    whileFirefox(async () => {
      const tabId = await tab("file:///tmp/report.html")
      stub.state.notifications.clear()
      expect(await ToolbarNotice.unavailable(tabId)).toBe("file")
      const notice = stub.state.notifications.get(`opencode-browser-toolbar:${tabId}`) as { message: string } | undefined
      expect(notice?.message).toContain("Access local files on your computer")
    }))
})
