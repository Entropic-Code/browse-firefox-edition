import type { JsonObject } from "../agent-relay/protocol"
import { isFirefox } from "../shared/browser"

export const LOAD_TIMEOUT_MS = 20_000
export const TEXT_LIMIT = 200_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function available() {
  return isFirefox()
}

export async function targetTab(requested: unknown): Promise<{ id: number; url?: string; title?: string }> {
  if (typeof requested === "number") return summarize(await tab(requested))
  for (const query of [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
  ] as chrome.tabs.QueryInfo[]) {
    const [found] = await chrome.tabs.query(query).catch(() => [])
    if (found?.id !== undefined) return summarize(found)
  }
  throw new Error("No active tab to use; pass a tab id")
}

function summarize(found: chrome.tabs.Tab) {
  if (found.id === undefined) throw new Error("That tab has no id")
  return {
    id: found.id,
    ...(typeof found.url === "string" ? { url: found.url } : {}),
    ...(typeof found.title === "string" ? { title: found.title } : {}),
  }
}

async function tab(tabId: number) {
  const found = await chrome.tabs.get(tabId).catch(() => undefined)
  if (!found) throw new Error(`No tab with id: ${tabId}`)
  return found
}

export async function loaded(tabId: number, timeoutMs = LOAD_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const current = await tab(tabId)
    if (current.status === "complete") return
    await sleep(100)
  }
}

type Evaluation = { readonly ok: boolean; readonly value?: unknown; readonly error?: string }

async function evaluate(tabId: number, expression: string, awaitPromise: boolean): Promise<Evaluation> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (source: string, wait: boolean) => {
      try {
        const pending = (0, eval)(source) as unknown
        const value = wait ? await pending : pending
        if (value === undefined) return { ok: true }
        return { ok: true, value: JSON.parse(JSON.stringify(value)) as unknown }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
    args: [expression, awaitPromise],
  })
  const result = injection?.result as Evaluation | undefined
  if (!result) throw new Error("The page returned no result; it may refuse extension scripts")
  return result
}

function valueType(value: unknown): string {
  if (value === null) return "object"
  if (Array.isArray(value)) return "object"
  return typeof value
}

function evaluationResult(evaluation: Evaluation, tabId: number): JsonObject {
  if (evaluation.ok) {
    return evaluation.value === undefined
      ? { result: { type: "undefined" } }
      : { result: { type: valueType(evaluation.value), value: evaluation.value as never } }
  }
  return {
    result: { type: "object", subtype: "error", description: evaluation.error ?? "Evaluation failed" },
    exceptionDetails: {
      exceptionId: 1,
      text: evaluation.error ?? "Evaluation failed",
      lineNumber: 0,
      columnNumber: 0,
    },
  }
}

export async function pageNavigate(tabId: number, url: string): Promise<JsonObject> {
  await chrome.tabs.update(tabId, { url })
  await loaded(tabId)
  const current = await tab(tabId)
  return {
    tabId,
    url: current.url ?? url,
    ...(typeof current.title === "string" ? { title: current.title } : {}),
  }
}

export async function pageRead(tabId: number, html: boolean): Promise<JsonObject> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (limit: number, withHtml: boolean) => {
      const body = document.body
      return {
        url: location.href,
        title: document.title,
        text: (body ? body.innerText : (document.documentElement?.textContent ?? "")).slice(0, limit),
        ...(withHtml ? { html: (document.documentElement?.outerHTML ?? "").slice(0, limit) } : {}),
      }
    },
    args: [TEXT_LIMIT, html],
  })
  const result = injection?.result as
    | { url: string; title: string; text: string; html?: string }
    | undefined
  if (!result) throw new Error("The page returned no content; it may refuse extension scripts")
  return {
    tabId,
    url: result.url,
    title: result.title,
    text: result.text,
    ...(html && result.html !== undefined ? { html: result.html } : {}),
  }
}

/**
 * Types text into the focused editor. Google Docs renders its document on a canvas and takes input through a hidden
 * contenteditable iframe, so plain DOM value writes don't reach it; the same iframe's execCommand does. Elsewhere the
 * focused input, textarea or contenteditable gets the text.
 */
export async function pageInsertText(tabId: number, value: string): Promise<JsonObject> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (text: string) => {
      const result: {
        ok: boolean
        via: string
        active?: string
        error?: string
        frame?: boolean
        body?: boolean
        editable?: boolean
        designMode?: string
        focused?: boolean
        canvas?: number
        target?: string
        before?: string
        after?: string
        inserted?: boolean
      } = { ok: false, via: "none" }
      const describe = (element: Element | null) =>
        element === null ? undefined : `${element.tagName.toLowerCase()}${(element as HTMLElement).isContentEditable ? "[editable]" : ""}`
      try {
        result.focused = document.hasFocus()
        result.canvas = document.querySelectorAll(".kix-canvas-tile-content").length
        const frame = document.querySelector<HTMLIFrameElement>(".docs-texteventtarget-iframe")
        result.frame = frame !== null
        const target = frame?.contentDocument
        if (frame?.contentWindow) frame.contentWindow.focus()
        result.body = target?.body !== null && target?.body !== undefined
        result.editable = target?.body?.isContentEditable ?? false
        result.designMode = target?.designMode
        const editable = target?.querySelector<HTMLElement>("[contenteditable]")
        if (target?.body) {
          const element = editable ?? target.body
          element.focus()
          target.body.focus()
          result.target = describe(element)
          result.active = describe(target.activeElement)
          result.before = element.textContent ?? ""
          // execCommand needs a collapsed caret inside the editable element; an unfocused hidden iframe has no selection.
          const selection = target.getSelection()
          if (selection) {
            const range = target.createRange()
            range.selectNodeContents(element)
            range.collapse(false)
            selection.removeAllRanges()
            selection.addRange(range)
          }
          result.via = "docs-iframe"
          result.ok = target.execCommand("insertText", false, text)
          result.after = element.textContent ?? ""
          result.inserted = result.after !== result.before
          return result
        }
        const active = document.activeElement as HTMLElement | null
        result.active = describe(active)
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          const start = active.selectionStart ?? active.value.length
          const end = active.selectionEnd ?? active.value.length
          active.value = active.value.slice(0, start) + text + active.value.slice(end)
          active.selectionStart = active.selectionEnd = start + text.length
          active.dispatchEvent(new Event("input", { bubbles: true }))
          result.ok = true
          result.via = "input"
        } else if (active?.isContentEditable) {
          result.via = "contenteditable"
          result.ok = document.execCommand("insertText", false, text)
        } else if (document.body) {
          document.body.focus()
          result.via = "body"
          result.ok = document.execCommand("insertText", false, text)
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error)
      }
      return result
    },
    args: [value],
  })
  return (injection?.result ?? { ok: false, via: "none", error: "The page returned no result" }) as JsonObject
}

type CaptureTab = (tabId: number, options?: { format?: string }) => Promise<string>

const captureTab = () => (chrome.tabs as unknown as { captureTab: CaptureTab }).captureTab

export async function pageScreenshot(tabId: number): Promise<JsonObject> {
  const dataUrl = await captureTab()(tabId, { format: "png" })
  const current = await tab(tabId)
  return {
    tabId,
    url: current.url ?? "",
    ...(typeof current.title === "string" ? { title: current.title } : {}),
    dataUrl: String(dataUrl),
  }
}

export async function sendCommand(tabId: number, method: string, params: JsonObject | undefined): Promise<JsonObject> {
  switch (method) {
    case "Page.enable":
    case "Page.disable":
    case "Page.setLifecycleEventsEnabled":
    case "Page.setBypassCSP":
    case "Page.stopLoading":
    case "Page.setInterceptFileChooserDialog":
    case "Runtime.enable":
    case "Runtime.disable":
    case "Runtime.runIfWaitingForDebugger":
    case "Runtime.releaseObject":
    case "Runtime.releaseObjectGroup":
    case "Log.enable":
    case "Log.disable":
    case "Log.clear":
    case "Network.enable":
    case "Network.disable":
    case "Network.setCacheDisabled":
    case "Network.setBypassServiceWorker":
    case "Network.setBlockedURLs":
    case "Network.emulateNetworkConditions":
    case "DOM.enable":
    case "DOM.disable":
    case "CSS.enable":
    case "CSS.disable":
    case "Accessibility.enable":
    case "Accessibility.disable":
    case "Animation.enable":
    case "Animation.disable":
    case "Overlay.enable":
    case "Overlay.disable":
    case "Security.enable":
    case "Security.disable":
    case "Inspector.enable":
    case "Inspector.disable":
    case "Fetch.enable":
    case "Fetch.disable":
    case "Emulation.setFocusEmulationEnabled":
    case "Emulation.setDeviceMetricsOverride":
    case "Emulation.clearDeviceMetricsOverride":
    case "Emulation.setEmulatedMedia":
    case "Emulation.setScrollbarsHidden":
    case "Emulation.setAutoDarkModeOverride":
    case "Target.setAutoAttach":
    case "Target.setDiscoverTargets":
    case "Target.detachFromTarget":
    case "Target.sendMessageToTarget":
    case "Storage.setCookies":
    case "Storage.clearCookies":
    case "Browser.setDownloadBehavior":
    case "Browser.resetPermissions":
    case "Input.dispatchMouseEvent":
    case "Input.dispatchKeyEvent":
    case "Input.insertText":
    case "Page.removeScriptToEvaluateOnNewDocument":
      return {}
    case "Target.getTargetInfo":
      return { targetInfo: await targetInfo(tabId) }
    case "Target.attachToTarget":
      return { sessionId: `firefox-native-${tabId}` }
    case "Target.closeTarget":
      await chrome.tabs.remove(tabId)
      return { success: true }
    case "Target.createTarget": {
      const created = await chrome.tabs.create({
        url: typeof params?.url === "string" ? params.url : "about:blank",
        active: params?.background === true ? false : true,
      })
      if (created.id === undefined) throw new Error("The browser created a tab without an id")
      await loaded(created.id)
      return { targetId: `tab-${created.id}` }
    }
    case "Browser.getVersion":
      return {
        protocolVersion: "1.3",
        product: `Firefox/${navigator.userAgent.replace(/^.*Firefox\/([\d.]+).*$/, "$1")}`,
        revision: "",
        userAgent: navigator.userAgent,
        jsVersion: "",
      }
    case "Page.navigate": {
      const url = typeof params?.url === "string" ? params.url : "about:blank"
      await pageNavigate(tabId, url)
      return { frameId: `tab-${tabId}`, loaderId: await loaderId(tabId) }
    }
    case "Page.reload": {
      await chrome.tabs.reload(tabId)
      await loaded(tabId)
      return {}
    }
    case "Page.bringToFront":
      await chrome.tabs.update(tabId, { active: true })
      return {}
    case "Page.getFrameTree": {
      const current = await tab(tabId)
      return { frameTree: { frame: await frame(tabId, current.url ?? "") } }
    }
    case "Page.getNavigationHistory": {
      const current = await tab(tabId)
      const url = current.url ?? ""
      return {
        currentIndex: 0,
        entries: [{ id: 0, url, userTypedURL: url, title: current.title ?? "", transitionType: "typed" }],
      }
    }
    case "Page.getLayoutMetrics": {
      const read = await evaluate(
        tabId,
        "JSON.stringify({ width: Math.max(document.documentElement.scrollWidth, innerWidth), height: Math.max(document.documentElement.scrollHeight, innerHeight) })",
        false,
      )
      const size = read.ok ? (JSON.parse(String(read.value ?? "{}")) as { width?: number; height?: number }) : {}
      const box = { x: 0, y: 0, width: size.width ?? 0, height: size.height ?? 0 }
      return { layoutViewport: { ...box, pageX: 0, pageY: 0, clientWidth: box.width, clientHeight: box.height }, contentSize: box, cssContentSize: box, cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: box.width, clientHeight: box.height } }
    }
    case "Page.captureScreenshot": {
      const page = await pageScreenshot(tabId)
      return { data: String(page.dataUrl ?? "").replace(/^data:image\/\w+;base64,/, "") }
    }
    case "Page.addScriptToEvaluateOnNewDocument":
      return { identifier: `firefox-native-${tabId}-${Date.now()}` }
    case "Runtime.evaluate": {
      const expression = typeof params?.expression === "string" ? params.expression : "undefined"
      const evaluation = await evaluate(tabId, expression, params?.awaitPromise === true)
      return evaluationResult(evaluation, tabId)
    }
    case "Runtime.callFunctionOn": {
      const declaration = typeof params?.functionDeclaration === "string" ? params.functionDeclaration : undefined
      if (declaration === undefined) return { result: { type: "undefined" } }
      const args = Array.isArray(params?.arguments) ? params.arguments : []
      const values = args.map((argument) => (typeof argument === "object" && argument !== null ? (argument as JsonObject).value : undefined))
      const expression = `(${declaration})(${values.map((value) => JSON.stringify(value)).join(", ")})`
      const evaluation = await evaluate(tabId, expression, params?.awaitPromise === true)
      return evaluationResult(evaluation, tabId)
    }
    case "Runtime.getProperties":
      return { result: [] }
    case "DOM.getDocument": {
      const current = await tab(tabId)
      return {
        root: {
          nodeId: 1,
          backendNodeId: 1,
          nodeType: 9,
          nodeName: "#document",
          localName: "",
          nodeValue: "",
          documentURL: current.url ?? "",
          baseURL: current.url ?? "",
          childNodeCount: 0,
        },
      }
    }
    case "DOM.querySelector":
      return { nodeId: 0 }
    case "DOM.querySelectorAll":
      return { nodeIds: [] }
    case "DOM.getContentQuads":
    case "DOM.getBoxModel":
      return {}
    case "DOM.scrollIntoViewIfNeeded":
      return {}
    case "Network.getCookies":
    case "Network.getAllCookies":
    case "Storage.getCookies":
      return { cookies: [] }
    case "Network.setCookie":
      return { success: true }
    case "Network.deleteCookies":
      return {}
  }
  throw new Error(`The Firefox-native driver does not implement ${method} yet`)
}

async function loaderId(tabId: number) {
  const current = await tab(tabId)
  return `${tabId}:${current.url ?? ""}`
}

async function frame(tabId: number, url: string) {
  return {
    id: `tab-${tabId}`,
    loaderId: `${tabId}:${url}`,
    url,
    domainAndRegistry: "",
    securityOrigin: url,
    mimeType: "text/html",
  }
}

async function targetInfo(tabId: number) {
  const current = await tab(tabId)
  return {
    targetId: `tab-${tabId}`,
    type: "page",
    title: current.title ?? "",
    url: current.url ?? "",
    attached: true,
    canAccessOpener: false,
    browserContextId: "firefox",
  }
}
