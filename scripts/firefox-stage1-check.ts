import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

type Json = Record<string, any>
type Pending = { resolve: (value: Json) => void; reject: (error: Error) => void }

const args = new Map<string, string>()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index]!.replace(/^--/, ""), process.argv[index + 1] ?? "")

const dist = path.resolve(args.get("dist") ?? "dist-firefox")
const relayPort = Number(args.get("port") ?? 19988)
const debugPort = Number(args.get("debug-port") ?? 9222)
const pairMode = (args.get("pair") ?? "form") as "file" | "form"
const code = args.get("code") ?? ""
const firefox = args.get("firefox") ?? "/usr/bin/firefox"
const hold = Number(args.get("hold") ?? 0)
const pairingFile = path.join(dist, "relay-pairing.json")
const tokenFile = path.join(process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share"), "browse", "relay-token")

const results: Json[] = []
const check = (name: string, ok: boolean, detail: Json = {}) => {
  results.push({ name, ok, ...detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(detail)}`)
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class Bidi {
  private next = 0
  private readonly pending = new Map<number, Pending>()
  readonly events: Json[] = []

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Json
      if (typeof message.id === "number") {
        const waiting = this.pending.get(message.id)
        if (!waiting) return
        this.pending.delete(message.id)
        if (message.error) waiting.reject(new Error(`${message.error}: ${message.message}`))
        else waiting.resolve(message.result ?? {})
        return
      }
      if (typeof message.method === "string") this.events.push(message)
    })
  }

  static async open(port: number): Promise<Bidi> {
    const deadline = Date.now() + 60_000
    let last: unknown
    while (Date.now() < deadline) {
      try {
        const socket = await new Promise<WebSocket>((resolve, reject) => {
          const candidate = new WebSocket(`ws://127.0.0.1:${port}/session`)
          candidate.addEventListener("open", () => resolve(candidate), { once: true })
          candidate.addEventListener("error", (event) => reject(new Error(String((event as unknown as { message?: string }).message ?? "socket error"))), { once: true })
        })
        return new Bidi(socket)
      } catch (error) {
        last = error
        await sleep(500)
      }
    }
    throw new Error(`no WebDriver BiDi session on 127.0.0.1:${port}: ${String(last)}`)
  }

  send(method: string, params: Json = {}): Promise<Json> {
    const id = ++this.next
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (!this.pending.delete(id)) return
        reject(new Error(`${method} timed out`))
      }, 60_000)
    })
  }

  close() {
    this.socket.close()
  }
}

const relay = async (pathname: string, init: RequestInit = {}) => {
  const token = readFileSync(tokenFile, "utf8").trim()
  const response = await fetch(`http://127.0.0.1:${relayPort}${pathname}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  })
  const text = await response.text()
  const body = (() => {
    try {
      return JSON.parse(text) as Json
    } catch {
      return { text } as Json
    }
  })()
  return { status: response.status, body }
}

const waitForConnection = async (seconds = 60) => {
  const deadline = Date.now() + seconds * 1_000
  let last: Json = {}
  while (Date.now() < deadline) {
    const status = await relay("/extension/status")
    last = status.body
    if (status.body.connected === true) return status.body
    await sleep(500)
  }
  return last
}

const flatten = (contexts: Json[]): Json[] => contexts.flatMap((context) => [context, ...flatten(context.children ?? [])])

const extensionContext = async (bidi: Bidi) => {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const tree = await bidi.send("browsingContext.getTree", {})
    const found = flatten(tree.contexts ?? []).find((context) => String(context.url ?? "").startsWith("moz-extension://"))
    if (found) return found
    await sleep(500)
  }
  return undefined
}

const evaluate = async (bidi: Bidi, context: string, expression: string) => {
  const response = await bidi.send("script.evaluate", { expression, target: { context }, awaitPromise: true, resultOwnership: "none" })
  if (response.type === "exception") throw new Error(JSON.stringify(response.exceptionDetails))
  return String(response.result?.value ?? "")
}

const pageState = (bidi: Bidi, context: string) =>
  evaluate(
    bidi,
    context,
    `(async () => JSON.stringify({
      href: location.href,
      origin: location.origin,
      text: document.body.innerText,
      diagnostics: (await chrome.runtime.sendMessage({ action: "agents.diagnostics" }))?.text ?? null,
    }))()`,
  ).then((value) => JSON.parse(value) as { href: string; origin: string; text: string; diagnostics: string | null })

const submitPairingForm = (pairingCode: string) =>
  `(async () => {
    const details = document.querySelector("details.advanced")
    if (details) details.open = true
    const form = document.querySelector("form.relay-form")
    if (!form) throw new Error("no pairing form on the page")
    const inputs = form.querySelectorAll("input")
    const fields = { address: inputs[0], code: inputs[1] }
    if (!fields.address || !fields.code) throw new Error("pairing form is missing a field")
    const typed = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set
    typed.call(fields.code, ${JSON.stringify(pairingCode)})
    fields.code.dispatchEvent(new Event("input", { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    const typedCode = fields.code.value
    form.requestSubmit()
    return JSON.stringify({ address: fields.address.value, typedCode })
  })()`

const main = async () => {
  const manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8")) as Json
  if (!manifest.browser_specific_settings || manifest.background?.service_worker) throw new Error(`${dist} is not the Firefox build`)
  if (!code) throw new Error("pass the live code from `browse pair` with --code")
  if (pairMode === "file") writeFileSync(pairingFile, `${JSON.stringify({ code, port: relayPort })}\n`)
  else if (existsSync(pairingFile)) throw new Error(`${pairingFile} exists; form mode must not use a pairing file`)

  const profile = mkdtempSync(path.join(tmpdir(), "browse-firefox-check-"))
  writeFileSync(
    path.join(profile, "user.js"),
    [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("browser.startup.page", 0);',
      'user_pref("extensions.autoDisableScopes", 0);',
      "",
    ].join("\n"),
  )

  const browser: ChildProcess = spawn(firefox, ["--headless", "--no-remote", "-remote-allow-system-access", `--remote-debugging-port=${debugPort}`, "--profile", profile], {
    env: { ...process.env, MOZ_HEADLESS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let browserLog = ""
  browser.stdout?.on("data", (chunk) => (browserLog += String(chunk)))
  browser.stderr?.on("data", (chunk) => (browserLog += String(chunk)))

  let bidi: Bidi | undefined
  try {
    bidi = await Bidi.open(debugPort)
    const session = await bidi.send("session.new", { capabilities: { alwaysMatch: { webSocketUrl: true } } })
    check("bidi session", typeof session.sessionId === "string", { sessionId: session.sessionId })
    await bidi.send("session.subscribe", { events: ["log.entryAdded"] })

    const installed = await bidi.send("webExtension.install", { extensionData: { type: "path", path: dist } })
    check("add-on installed", installed.extension === "browse@opencode.ai", { extension: installed.extension })

    const opened = await extensionContext(bidi)
    const context = opened === undefined ? undefined : String(opened.context)
    check("add-on opened its own page", context !== undefined, { url: opened?.url })
    if (context === undefined) throw new Error("the add-on opened no extension page to script")

    await sleep(1_000)
    const onboarding = await pageState(bidi, context)
    check("onboarding page painted", onboarding.text.length > 0, { head: onboarding.text.split("\n").filter(Boolean).slice(0, 5) })

    await evaluate(bidi, context, 'location.href = "settings.html"')
    await sleep(2_000)

    if (pairMode === "form") {
      check("no pairing file in the add-on", !existsSync(pairingFile), { path: pairingFile })
      const typed = JSON.parse(await evaluate(bidi, context, submitPairingForm(code))) as { address: string; typedCode: string }
      check("settings form submitted the live code", typed.typedCode === code.toUpperCase(), typed)
      const started = Date.now()
      const status = await waitForConnection()
      check("form pairing connected without a pairing file", status.connected === true, {
        connected: status.connected,
        pairing: status.pairingState,
        name: status.browsers?.[0]?.name,
        origin: status.origin,
        uuid: typeof status.origin === "string" && /^moz-extension:\/\/[0-9a-f-]{36}$/.test(status.origin),
        seconds: Math.round((Date.now() - started) / 100) / 10,
        pairingFile: existsSync(pairingFile),
      })
    }

    const status = await waitForConnection()
    check("relay sees it connected", status.connected === true, {
      connected: status.connected,
      pairing: status.pairingState,
      origin: status.origin,
      name: status.browsers?.[0]?.name,
      diagnostics: status.connected === true ? undefined : onboarding.diagnostics,
    })
    check("relay origin is this profile's moz-extension UUID", /^moz-extension:\/\/[0-9a-f-]{36}$/.test(String(status.origin)), { origin: status.origin })

    await evaluate(bidi, context, 'document.querySelectorAll("details").forEach((item) => (item.open = true))')
    const settings = await pageState(bidi, context)
    const settingsErrors = bidi.events.filter((event) => event.method === "log.entryAdded" && event.params?.level === "error")
    check("settings page shows the connected state", /Connected/.test(settings.text), { connected: /Connected/.test(settings.text) })
    check("settings page labels the Firefox add-on", /Add-on ID/.test(settings.text), { addOnId: /Add-on ID/.test(settings.text) })
    check("settings page has no console errors", settingsErrors.length === 0, { errors: settingsErrors.map((event) => event.params?.text) })
    check("add-on diagnostics reachable", typeof settings.diagnostics === "string", { diagnostics: settings.diagnostics?.slice(0, 260) })

    await evaluate(bidi, context, 'location.href = "onboarding.html"')
    await sleep(2_000)
    const connectedOnboarding = await pageState(bidi, context)
    const onboardingErrors = bidi.events.filter((event) => event.method === "log.entryAdded" && event.params?.level === "error")
    check("onboarding page shows the connected state", /Connected/.test(connectedOnboarding.text), {
      connected: /Connected/.test(connectedOnboarding.text),
      head: connectedOnboarding.text.split("\n").filter(Boolean).slice(0, 4),
    })
    check("onboarding page has no console errors", onboardingErrors.length === 0, { errors: onboardingErrors.map((event) => event.params?.text) })

    const page = (body: Json) => relay("/page", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })

    const navigated = await page({ action: "navigate", url: "https://example.com/" })
    const tabId = navigated.body.tabId
    check(
      "native driver navigates a real page",
      navigated.status === 200 && typeof tabId === "number" && String(navigated.body.url ?? "").includes("example.com"),
      { status: navigated.status, tabId, url: navigated.body.url, title: navigated.body.title, error: navigated.body.error },
    )

    const read = await page({ action: "read", ...(typeof tabId === "number" ? { tabId } : {}) })
    const readText = String(read.body.text ?? "")
    check("native driver reads real page content", read.status === 200 && /documentation examples|Example Domain/i.test(readText), {
      status: read.status,
      title: read.body.title,
      head: readText.split("\n").filter(Boolean).slice(0, 4),
      error: read.body.error,
    })

    const shot = await page({ action: "screenshot", ...(typeof tabId === "number" ? { tabId } : {}) })
    const dataUrl = String(shot.body.dataUrl ?? "")
    check("native driver captures a screenshot", shot.status === 200 && dataUrl.startsWith("data:image/png;base64,") && dataUrl.length > 2_000, {
      status: shot.status,
      bytes: dataUrl.length,
      error: shot.body.error,
    })

    const lend = await page({ action: "lend", ...(typeof tabId === "number" ? { tabId } : {}) })
    const lendBody = JSON.stringify(lend.body)
    const targetId = lend.body.targetInfo?.targetId
    check(
      "lending a tab attaches instead of NO_DEBUGGER",
      lend.status === 200 && typeof targetId === "string" && !/can't attach a debugger|NO_DEBUGGER/i.test(lendBody),
      { status: lend.status, targetId, error: lend.body.error },
    )

    const tools = await relay("/tools")
    const names: string[] = Array.isArray(tools.body) ? tools.body.map((tool: Json) => String(tool.name)) : []
    const pageTool = names.find((item) => /navigate/.test(item))
    if (names.length === 0) console.log(`SKIP relay lists a page tool (no HTTP tool catalog: status ${tools.status})`)
    else check("relay lists a page tool", pageTool !== undefined, { tools: names })

    if (pageTool) {
      const call = await relay("/tools/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: pageTool, arguments: { url: "https://example.com/" } }),
      })
      const error = String(call.body.error ?? call.body.text ?? call.body.content?.[0]?.text ?? "")
      check("agent page command no longer reports NO_DEBUGGER", !/Firefox can't attach a debugger/.test(error), {
        tool: pageTool,
        httpStatus: call.status,
        outcome: error ? error.slice(0, 200) : "ok",
      })
    }

    if (hold > 0) {
      console.log(`HOLDING ${hold}ms`)
      await sleep(hold)
    }
  } finally {
    try {
      await bidi?.send("browser.close")
    } catch {
      bidi?.close()
    }
    browser.kill("SIGTERM")
    if (pairMode === "file") rmSync(pairingFile, { force: true })
    rmSync(profile, { recursive: true, force: true })
  }

  const failed = results.filter((result) => !result.ok)
  console.log(JSON.stringify({ ok: failed.length === 0, mode: pairMode, failed: failed.map((result) => result.name) }, null, 2))
  if (failed.length) {
    console.log(browserLog.split("\n").slice(-30).join("\n"))
    process.exit(1)
  }
}

await main()
