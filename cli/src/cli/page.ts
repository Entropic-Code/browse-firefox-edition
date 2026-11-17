import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { writeFile } from "node:fs/promises"
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
  Command.withSubcommands([pageGoto, pageRead, pageScreenshot]),
)

registerCliCommand(210, () => page)
