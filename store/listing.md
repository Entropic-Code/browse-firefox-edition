# addons.mozilla.org listing

Copy these into the AMO developer hub (**Developer Hub → browse → Edit listing**). The release build is
`release/firefox/browse-<version>.zip`, made by `bun run build-for-amo` (see RELEASING.md); the same add-on is built
from source by AMO's reviewers with `bun install && bun run build-for-amo`.

## Store listing

**Requires:** Firefox 139 or newer (`strict_min_version` 139.0: the add-on uses the `tabGroups` API, which Firefox
shipped in 139; `tabs.group`/`tabs.ungroup` alone would allow 138).

**Name:** browse

**Summary (250 chars max):**
Let your coding agent use your real browser: open and drive tabs, take screenshots, and hand logins back to you.

**Category:** Developer Tools

**Description:**
browse lets your coding agent use your real browser: OpenCode, Claude Code, Codex, Cursor or any agent that supports MCP.

- Agents open their own tabs in the background, together in one "Agents" group at the start of your tab strip, so they stay out of your way. Prefer a separate window, a group per task or no groups? Change it in browse's settings. Idle agent tabs close by themselves after 10 minutes, or the time you set.
- Want an agent to use a tab you already have open? Click the toolbar button on it. Click again to take it back, even while the agent is working.
- Hand off when it's your turn: logins, 2FA, passkeys and payments stay with you, then the agent continues.
- Firefox has no debugger API and no CDP since Firefox 141, so this build drives pages through its own Firefox-native driver (`browse page goto|read|screenshot`, and lending a tab attaches). Agent tools that need CDP are not available in Firefox yet.

Set it up once: ask your agent to set up browse, or run
curl -fsSL https://opencode.ai/browse/install | bash
(on Windows: irm https://opencode.ai/browse/install.ps1 | iex). It installs browse and adds it to your agents. Load the
add-on from your checkout with `./setup-full.sh` (or `about:debugging#/runtime/this-firefox`), then run `browse pair`
and enter the code on the add-on's options page. Your agent on another computer? The add-on's setup page connects to it
too.

Everything stays between your browser and browse on your computer (or the computer you pair it with). The add-on has no
server of its own.

## Privacy

**Single purpose:**
Let the user's AI coding agent (through browse running on their computer) use the user's browser tabs at their request.

**Permission justifications:**
- `tabs`, `tabGroups`: Open and list tabs for the agent, and group the agent's tabs so the user can see them.
- `storage`: Remember which tabs agents opened, the agent tab groups and window, the user's settings from browse's settings page (where agent tabs open and how they're grouped, when idle ones close, human-like input, handoff notifications), and the pairing code the user entered.
- `alarms`: Keep the connection to the user's browse relay alive, reconnect, and close agent tabs left idle.
- `scripting`: Add the add-on's handoff card only to tabs agents use (not to every page), so the user can finish a login or payment step and hand the tab back.
- `webNavigation`: Notice when an agent's click opens a new tab or popup, so it joins the agent's tab group (and the agent's own window, if the user chose one), the user's current tab stays in front, and it closes with the agent's other tabs.
- `notifications`: Tell the user an agent needs them, or on every handoff if the user chose that in browse's settings. Clicking the notification shows the tab. When notifications are turned off, the card is shown instead. Used for nothing else.
- `management`: Tell a build loaded from disk (temporary, for development) from a signed install, so the settings page can explain how the add-on was installed.
- Host permission `<all_urls>`: Agents work on whatever site the user asks for, and the page shows a card when an agent waits for the user there.

This build asks for no `debugger` permission: Firefox has no such API, so the add-on drives pages through its own
driver using the `tabs` and `scripting` permissions instead.

**Remote code:** No. All add-on code ships in the package.

**Data usage:** Check "Website content" and "User activity" (agents read and interact with pages). Certify: not sold, not used for unrelated purposes, not used for credit decisions. Data goes only to browse on the user's computer (or the computer they paired it with).

**Privacy policy URL:** host `privacy-policy.md` (for example at opencode.ai/browser/privacy).

**Notes for reviewers:** browse is a local developer tool. The add-on never contacts a server of its own: it connects
only to the relay the user runs (`ws://127.0.0.1:19988` by default, or the address the user pairs it with), and proves
it holds the key that relay gave it when the user entered a one-time pairing code. There is no remote code, no
analytics and no account. To test it, run `browse pair` from the CLI and enter the printed code on the add-on's
options page.
