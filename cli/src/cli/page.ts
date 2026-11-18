import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import * as RelayClient from "../relay/client.ts"
import { emitJson, ensureCliRelayAndExtension, jsonFlag } from "./context.ts"
import { registerCliCommand } from "./registry.ts"

const tabFlag = Flag.Int("tab").pipe(
  Flag.optional,
  Flag.withDescription("Tab id to drive; defaults to the active tab"),
)

const pageGoto = Command.make(
  "goto",
  {
    url: Argument.String("url"),
    tab: tabFlag,
    json: jsonFlag,
  },
  Effect.fn("Cli.pageGoto")(function* ({ url, tab, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const tabId = Option.getOrUndefined(tab)
    const result = yield* relay.pageDrive({ action: "navigate", url, ...(tabId === undefined ? {} : { tabId }) })
    if (json) return yield* emitJson(result)
    yield* Console.log(`Tab ${result.tabId ?? "?"}: ${result.url ?? url}`)
    if (result.title) yield* Console.log(`Title: ${result.title}`)
  }),
).pipe(Command.withDescription("Navigate a tab to a URL and wait for it to load"))

const pageRead = Command.make(
  "read",
  {
    tab: tabFlag,
    html: Flag.Boolean("html").pipe(
      Flag.withDefault(false),
      Flag.withDescription("Include the page's HTML"),
    ),
    json: jsonFlag,
  },
  Effect.fn("Cli.pageRead")(function* ({ tab, html, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const tabId = Option.getOrUndefined(tab)
    const result = yield* relay.pageDrive({
      action: "read",
      ...(tabId === undefined ? {} : { tabId }),
      ...(html ? { html: true } : {}),
    })
    if (json) return yield* emitJson(result)
    yield* Console.log(`${result.title ?? ""}\n${result.url ?? ""}\n`)
    yield* Console.log(result.text ?? "")
    if (html && result.html) yield* Console.log(result.html)
  }),
).pipe(Command.withDescription("Read the page's URL, title and text"))

const pageEval = Command.make(
  "eval",
  {
    tab: tabFlag,
    expression: Flag.String("expression").pipe(
      Flag.optional,
      Flag.withDescription("JavaScript expression to evaluate in the page"),
    ),
    file: Flag.String("file").pipe(
      Flag.optional,
      Flag.withDescription("Read the JavaScript expression from a file instead"),
    ),
    json: jsonFlag,
  },
  Effect.fn("Cli.pageEval")(function* ({ tab, expression, file, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const inline = Option.getOrUndefined(expression)
    const from = Option.getOrUndefined(file)
    if (inline === undefined && from === undefined)
      return yield* Effect.fail(new Error("Pass --expression or --file"))
    const source = inline ?? (yield* Effect.promise(() => readFile(path.resolve(from!), "utf8")))
    const tabId = Option.getOrUndefined(tab)
    const result = yield* relay.pageDrive({
      action: "eval",
      ...(tabId === undefined ? {} : { tabId }),
      expression: source,
      awaitPromise: true,
    })
    if (json) return yield* emitJson(result)
    yield* Console.log(JSON.stringify(result.result ?? result, null, 2))
  }),
).pipe(Command.withDescription("Evaluate JavaScript in a tab through the Firefox driver"))

const pageFocus = Command.make(
  "focus",
  {
    tab: tabFlag,
    json: jsonFlag,
  },
  Effect.fn("Cli.pageFocus")(function* ({ tab, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const tabId = Option.getOrUndefined(tab)
    const result = yield* relay.pageDrive({ action: "focus", ...(tabId === undefined ? {} : { tabId }) })
    if (json) return yield* emitJson(result)
    yield* Console.log(`Focused tab ${tabId ?? "?"}`)
  }),
).pipe(Command.withDescription("Bring a tab to the front of its window"))

const pageType = Command.make(
  "type",
  {
    tab: tabFlag,
    text: Flag.String("text").pipe(
      Flag.optional,
      Flag.withDescription("Text to enter in the focused editor"),
    ),
    file: Flag.String("file").pipe(
      Flag.optional,
      Flag.withDescription("Read the text from a file instead"),
    ),
    json: jsonFlag,
  },
  Effect.fn("Cli.pageType")(function* ({ tab, text, file, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const inline = Option.getOrUndefined(text)
    const from = Option.getOrUndefined(file)
    if (inline === undefined && from === undefined)
      return yield* Effect.fail(new Error("Pass --text or --file"))
    const source = inline ?? (yield* Effect.promise(() => readFile(path.resolve(from!), "utf8")))
    const tabId = Option.getOrUndefined(tab)
    const result = yield* relay.pageDrive({
      action: "type",
      ...(tabId === undefined ? {} : { tabId }),
      text: source,
    })
    if (json) return yield* emitJson(result)
    yield* Console.log(JSON.stringify(result.result ?? result, null, 2))
  }),
).pipe(Command.withDescription("Enter text in a tab through the Firefox driver"))

const pageScreenshot = Command.make(
  "screenshot",
  {
    tab: tabFlag,
    out: Flag.String("out").pipe(
      Flag.optional,
      Flag.withDescription("Where to write the PNG (default browse-screenshot.png)"),
    ),
    json: jsonFlag,
  },
  Effect.fn("Cli.pageScreenshot")(function* ({ tab, out, json }) {
    const relay = yield* RelayClient.Service
    yield* ensureCliRelayAndExtension()
    const tabId = Option.getOrUndefined(tab)
    const result = yield* relay.pageDrive({ action: "screenshot", ...(tabId === undefined ? {} : { tabId }) })
    const file = path.resolve(Option.getOrUndefined(out) ?? "browse-screenshot.png")
    const png = Buffer.from((result.dataUrl ?? "").replace(/^data:image\/\w+;base64,/, ""), "base64")
    yield* Effect.promise(() => writeFile(file, png))
    if (json) return yield* emitJson({ ...result, path: file, bytes: png.byteLength })
    yield* Console.log(`Tab ${result.tabId ?? "?"}: ${result.url ?? ""}`)
    if (result.title) yield* Console.log(`Title: ${result.title}`)
    yield* Console.log(`Saved ${file} (${png.byteLength} bytes)`)
  }),
).pipe(Command.withDescription("Capture the tab as a PNG"))

const page = Command.make("page").pipe(
  Command.withDescription("Drive a page natively through the extension (the Firefox driver)"),
  Command.withSubcommands([pageGoto, pageRead, pageEval, pageType, pageFocus, pageScreenshot]),
)

registerCliCommand(210, () => page)
