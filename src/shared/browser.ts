const scope = globalThis as typeof globalThis & { browser?: typeof chrome; chrome?: typeof chrome }

function installBrowserAlias() {
  if (scope.browser === undefined) return
  try {
    scope.chrome = scope.browser
  } catch {
    return
  }
}

installBrowserAlias()

export const extensionBaseUrl = () => chrome.runtime.getURL("")

export function isFirefox() {
  return new URL(extensionBaseUrl()).protocol === "moz-extension:"
}
