# Releasing browse

One version ships an extension zip, the npm package `@opencode/browse` (`opencode-browse-<version>.tgz`: a Node
launcher, for `npx` and `npm install -g`) and the `browse` binaries. The npm package carries no extension.

The CLI, relay and MCP server are the Rust `browse` binary (crate `rust/crates/browse`, workspace `rust/`; the
TypeScript CLI in `cli/` is kept as the reference and isn't built or released anymore). `@opencode/browse` holds only
`dist/cli.mjs` ([rust/npm/browse.mjs](rust/npm/browse.mjs)), which runs the binary of the optional dependency npm
installed for the machine, `@opencode/browse-<target>`; `dist/cli.mjs` stays the bin path because agent configs written
by the TypeScript CLI run `node .../dist/cli.mjs mcp`. The version is baked into the binary at build time
(`BROWSE_VERSION`, with the run's `BROWSE_BUILD_ID`), and `rust/Cargo.toml`/`Cargo.lock` carry it too
(`scripts/version.ts`). Each binary is published two ways:
as an npm package `@opencode/browse-<target>` holding `bin/browse` (`bin/browse.exe` on Windows) and a package.json with
`os`, `cpu` and, on Linux, `libc`; and as one target per binary on Anomaly's release service, which the [install
script](install) downloads. The [release service](#the-release-service) file is
`opencode-browse-<target>-<version>.tgz`; it carries the same verified bytes as the npm package. Targets:
`linux-x64`, `linux-x64-baseline`, `linux-arm64`, `linux-x64-musl`, `linux-x64-baseline-musl`, `linux-arm64-musl`,
`darwin-arm64`, `darwin-x64`, `darwin-x64-baseline`, `windows-x64`, `windows-x64-baseline` (Windows on ARM64 runs x64).
The service names macOS `macos-*`. A `-baseline` target carries the same binary as its base target (Rust's x86-64
target doesn't use AVX2), and `@opencode/browse` depends only on the seven base targets. Locally:
`cd rust && BROWSE_VERSION=<version> script/release.sh linux-x64 linux-x64-musl`, then
`bun scripts/npm-package.ts platforms --binaries rust/dist --out <dir>` (with `--target <name>` for only some) and
`bun scripts/npm-package.ts main --out <dir>`.

Releases run only in GitHub Actions ([.github/workflows/release.yml](.github/workflows/release.yml)). Nobody has release
secrets locally, and nothing is built, tagged or published from a laptop. Work lands on `dev`, the default branch.

| Mode | Starts from | Version | Publishes |
| --- | --- | --- | --- |
| dev | every push to `dev` (not Markdown-only) | `<next patch>-dev.<run>`, e.g. `0.2.1-dev.57` | the [release service](#the-release-service) channel `dev` (`browse-extension-<version>.zip`, loaded unpacked, and every CLI binary target), then npm dist-tag `dev` (the binaries, then `@opencode/browse`) |
| stable | **Actions → Release → Run workflow** on `dev` with a bump or version and release notes | `x.y.z` | tag `v<version>`, the [release service](#the-release-service) channel `stable` (the extension zip and every CLI binary target), npm `latest`, the Firefox add-on `release/firefox/browse-<version>.zip` (built by `bun run build-for-amo`, signed and uploaded to addons.mozilla.org by hand — [The Firefox add-on](#the-firefox-add-on)), the GitHub release |
| check | the same button with bump `check` and no version, on any branch (`gh workflow run release.yml --ref <branch>`) | `cli/package.json` | nothing: builds, checks and attests the stable artifacts and runs every publish script, the release service included, as a dry run |

There's no `production` branch: browse has no website. If it gets one, the site deploys from `production`, as in
opencode and Hex; releases still come from `dev`.

## Cutting a stable release

1. Write the notes: `bun run release --draft` writes `release-notes.md` from the commits since the last tag. The format
   is a summary line, then `## Major` (a `### Title`, a sentence or two, an optional `Icon: icons/<slug>.svg`),
   `## Improvements` and `## Fixes`, one line each, written for the person using it. No `TODO` may be left.
2. Dispatch: **Actions → Release → Run workflow**, branch `dev`, bump `patch`/`minor`/`major` (or an exact version)
   and the notes. The notes field is a single line in the browser, so `bun run release patch release-notes.md` does
   the same with `gh workflow run`.
3. The run (only repository admins and maintainers may start one; `plan` checks the dispatching actor):

```
plan    version from the newest of cli/package.json and the newest v* tag, + bump (the tag exists before any publish,
        so a release commit that missed dev still counts), on a commit that contains the newest tag's commit; actor is
        admin or maintain; notes well-formed; not on npm yet
tag     commits the versions (cli/package.json, package.json, public/manifest.json, rust/Cargo.toml, rust/Cargo.lock)
        and changelog/<version>.md from the notes on the dispatched commit, pushes only the tag v<version> (deploy key);
        git, sed, awk and jq only
build   from the tag: install, typecheck, extension and cargo tests, release:check (zip + npm launcher tarball +
        artifact checks), SHA256SUMS digest
build-binary    one job per Rust build (linux gnu/musl x64/arm64 with cargo-zigbuild, glibc 2.17; macOS arm64/x64 on
        macos-15; windows-x64 with a static C runtime), version and build id baked in; no secrets
build-binaries  packs and checks the @opencode/browse-<target> tarballs (every target; baseline = base binary), runs
        the linux-x64 ones: the install script against a local release service, relay + MCP, npm install of
        @opencode/browse with its platform package
sign-macos      optional (repository variable MACOS_SIGNING=true): Developer ID signs the macOS binaries; skipped now
sign-windows    optional (repository variable WINDOWS_SIGNING=true): Authenticode signs the Windows binaries (Azure
        Trusted Signing; Smart App Control blocks an unsigned browse.exe); skipped now
attest  build provenance for the zip and every tarball (Sigstore)
publish-release-service       the extension zip and every CLI binary target to the release service (channel dev or
        stable); a check run prints the list and publishes nothing
publish-npm  npm latest (--ignore-scripts, provenance; the platform packages first, then @opencode/browse).
        The Firefox add-on is built, signed and uploaded to addons.mozilla.org by hand, see The Firefox add-on
publish-github-release        the release on v<version>: notes, zip, tarball, SHA256SUMS, attestation
push-release-to-dev           pushes the release commit to dev (deploy key), so dev builds count up from it
```

AMO review takes hours to a few days (it shows in the Developer Hub); a version still in review can be cancelled
there, and a fixed version needs a new version number. Every running relay checks the release service at launch and
hourly, in every update mode; binary and npm installs switch when no agent is using the browser; a signed Firefox
add-on updates from addons.mozilla.org, and a temporary one is replaced by rebuilding it
(`./setup-full.sh --extension-only`).

**If a job fails**, fix it and rerun the failed jobs. Publishing is idempotent: a version that's already on npm,
already uploaded to addons.mozilla.org, or already current on the release service is skipped, and the tag is reused when it
holds the same tree.

An AMO upload that fails validation means a listing field or the manifest needs fixing, not the build: fix the
field the Developer Hub names (**Privacy practices** for a new permission, **Listing** for the summary or
description), worded from [store/listing.md](store/listing.md), then upload again. A rejected version needs a new
version number, so bump and rebuild rather than re-uploading the same one.

## The Firefox add-on

`bun run build-for-amo` writes `release/firefox/browse-<version>.zip` (22 files, no pairing code, `browse@opencode.ai`
as the gecko id, `strict_min_version` 139.0). That zip is what reviewers see and what users install from
addons.mozilla.org; nothing in it is browser-specific beyond Firefox.

1. Build and check it: `bun run build:firefox`, `bun run lint:firefox` (0 errors expected; warnings are AMO-safe
   ones) and `bun run build-for-amo`.
2. Sign it: `web-ext sign --source-dir dist-firefox --artifacts-dir release/firefox/signed --channel listed` with
   the AMO API key and secret from the Developer Hub (**Tools → Manage API keys**), or upload the zip in the
   Developer Hub and let AMO sign it. `--channel unlisted` produces a signed `.xpi` for a direct download instead
   of a store listing; that one installs permanently without developer mode.
3. Fill the listing from [store/listing.md](store/listing.md) (summary, description, category, permission
   justifications, privacy policy URL) before the first submission, and again whenever a permission is added.
4. A version already in review can be cancelled in the Developer Hub; a rejected version needs a new version number,
   so bump and rebuild rather than re-uploading the same one.

Temporary installs (`about:debugging#/runtime/this-firefox`, or `./setup-full.sh`) need no signing and are how a
dev build and the end-to-end check are tested. They last until Firefox quits.

## The security boundary

Every job that holds a secret, an OIDC token or a write token (tag, attest, every publish job) runs only code in
`.github/`: the workflow file and the shell scripts in [.github/release/](.github/release/), checked out with a sparse
checkout of `/.github/release/`. Those jobs treat the build artifacts as data: each artifact must match the SHA256SUMS
digest its job reported and, before publishing, its GitHub attestation from this workflow on `dev`. They never run
repository code, `bun install` or package lifecycle scripts. Only `build` runs repository code, and it has no
environment, secrets or id-token. The tag job checks out the repository but runs only `tag-release.sh` (git and jq,
hooks off).

So `.github/` is what to protect: [.github/CODEOWNERS](.github/CODEOWNERS) makes Dax and Ryan its owners, and the
rulesets below require their review. The jobs that need a secret run in the environment `release`, which admits only
`dev`, and fetch it from AWS Secrets Manager ([Secrets](#secrets)).

## How a dev install gets its extension

The Firefox add-on is built from the checkout: `bun run build:firefox` writes `dist-firefox/`, and
`./setup-full.sh --extension-only` builds it and loads it into the profile you pick as a temporary add-on (quit that
Firefox window first). The relay accepts older add-on protocols, so a dev CLI also works with an older signed add-on.
Nothing is published to addons.mozilla.org from CI: every upload is reviewed, too slow for a build per push.

`./setup-full.sh` installs and configures the TypeScript CLI in `cli/` (the reference implementation); the released
Rust binary is what the install script, npm and the store builds run. Setup, `pair`, `status` and `uninstall` behave
the same in both, while released-binary-only commands (`browse tools`, `browse update --mode`, `browse <tool>`) come
with the installed binary.

## The release service

`https://anoma.ly/release` is Anomaly's update service ([anomalyco/release](https://github.com/anomalyco/release)).
Like Hex and OpenCode, a job in a named environment trades its GitHub OIDC token for a publish session through
`client.sh` ([.github/release/publish-release-service.sh](.github/release/publish-release-service.sh)); the service
checks the token against `registry/browse.json` there ([scripts/release-registry.json](scripts/release-registry.json)).

| Artifact | Target | File | Latest link |
| --- | --- | --- | --- |
| `cli` | `linux-x64`, `linux-x64-baseline`, `linux-arm64`, `linux-x64-musl`, `linux-x64-baseline-musl`, `linux-arm64-musl` | `opencode-browse-<target>-<version>.tgz` | https://anoma.ly/release/browse/cli/stable/linux-x64 |
| `cli` | `macos-arm64`, `macos-x64`, `macos-x64-baseline` (files say `darwin-*`) | `opencode-browse-darwin-<arch>-<version>.tgz` | https://anoma.ly/release/browse/cli/stable/macos-arm64 |
| `cli` | `windows-x64`, `windows-x64-baseline` | `opencode-browse-windows-<arch>-<version>.tgz` | https://anoma.ly/release/browse/cli/stable/windows-x64 |

Every target has a `.../<target>/info` with its version, size and SHA-256. `install` reads the manifest, checks the
file's size and SHA-256 and installs it; every relay (except a checkout build) polls `cli/<stable|dev>.json` at launch
and hourly, even with updates off, with User-Agent `browse/<channel>/<version>/cli/<kind>` (`binary`, `npm`, `bun`,
`pnpm`, `yarn`, `volta`, `npx`, `bunx`, `pnpm-dlx`, `yarn-dlx`, `other` for an install browse didn't make, which only checks), which the protocol allows after its artifact segment
and lets analytics split installs by kind. A binary install downloads the manifest's file; a global install runs its
package manager for `@opencode/browse@<the manifest's version>`, and retries quietly while npm doesn't have that version
yet. `--version` stays on npm because the protocol has one current release per channel and no version lookup.

A TypeScript binary install's updater (0.0.17 and earlier) runs the install script baked into the binary it is running,
so those releases keep reading future channel manifests with their own installer: the cli tarballs keep the layout
`package/bin/browse[.exe]`. The Rust binary's updater ([rust/crates/browse/src/update.rs](rust/crates/browse/src/update.rs))
reads the manifest itself and unpacks the same tarball. When a TypeScript relay has installed the Rust binary it runs
`browse runtime-switch <version>`, and the Rust CLI stops any TypeScript relay it finds (POST /shutdown), so the Rust
relay takes over ([rust/crates/browse/src/legacy.rs](rust/crates/browse/src/legacy.rs)). Manifest changes must stay readable by
older installers: relative `url`s, flat target objects, and `release.version` before any other `version` key.

## One-time setup

1. **Default branch** `dev` (Settings → General).
2. **Release service.** Open a PR on anomalyco/release updating [scripts/release-registry.json](scripts/release-registry.json)
   as `registry/browse.json` (listed in `registry/index.ts`): workflow `.github/workflows/release.yml` on
   `refs/heads/dev` in environment `release`, artifacts `cli` and `extension`, channels `stable`, `beta` and `dev`.
   Stable and dev share the ref because browse's stable release is a `workflow_dispatch` on `dev` (the tag job pushes
   `v<version>`, but the run's OIDC ref stays `refs/heads/dev`); `plan-release.sh` is what keeps a push to dev from
   publishing stable. Merge and deploy it there **before the next stable release**: until then the service refuses the
   stable channel, and the installer has no stable manifest to read.
3. **addons.mozilla.org listing.** In the [AMO Developer Hub](https://addons.mozilla.org/developers/addons) create
   the add-on (the API can't), choose **On this site** as its distribution, upload
   `release/firefox/browse-<version>.zip` from `bun run build-for-amo`, fill the listing from
   [store/listing.md](store/listing.md) and submit it for review. The gecko id `browse@opencode.ai` in
   `manifest.firefox.json` fixes the add-on's URL. Generate API keys under **Tools → Manage API keys** for signing;
   keep them with the release secrets, never in the repository.
4. **Environment `release`** (Settings → Environments): *Deployment branches and tags* → *Selected* → branch `dev`
   only. No required reviewers: who may release is decided by `plan`'s admin/maintain check and the rulesets. It holds
   no secrets: it is the environment claim the AWS role's trust requires ([Secrets](#secrets)).
5. **Release deploy key.** `ssh-keygen -t ed25519 -N "" -C "browse release tags" -f release-tag-key`; add
   `release-tag-key.pub` under Settings → Deploy keys with write access, store the private key as
   `browse/release/RELEASE_TAG_KEY` (`bun set browse release RELEASE_TAG_KEY < release-tag-key`), and delete both files.
6. **Rulesets** (Settings → Rules):
   - branch `dev`: require a pull request with code owner review, block force pushes and deletion; bypass:
     *Repository admin* and *Deploy keys* (the release commit comes back to dev with the deploy key).
   - tags `v*`: restrict creation, updates and deletion; bypass: *Repository admin* and *Deploy keys* (the tag job).
7. **Actions** (Settings → Actions → General): require actions pinned to a full-length commit SHA.
8. **npm.** Every package publishes with trusted publishing: `@opencode/browse` and each `@opencode/browse-<target>`
   trust GitHub Actions in `anomalyco/browse`, workflow `release.yml`. There is no npm token anywhere.

   The eleven platform packages are set up already (November 2026): trusted publishing can only be configured on a
   package that exists, so each `@opencode/browse-<target>` was published once by hand as an empty `0.0.0` on the
   `placeholder` tag, then trusted like `@opencode/browse`, with no environment restriction. A new target needs the same:

   ```sh
   npm publish --access public --tag placeholder   # in a folder with just package.json (name, version 0.0.0) and a README
   npm trust github "@opencode/browse-<target>" --file release.yml --repository anomalyco/browse --allow-publish -y
   ```

   `npm trust list @opencode/browse-<target>` checks one.
9. **macOS signing (optional).** Without it the macOS binaries carry the ad-hoc signature the Rust linker gives
    them, which runs fine from the install script and npm (neither sets quarantine). To sign with a Developer ID:
    the certificate is `shared/APPLE_SIGNING_CERTIFICATE` in AWS (a Developer ID Application certificate exported
    without a password, base64 encoded, shared with every Anomaly app); then `gh variable set MACOS_SIGNING --body true`
    and the sign-macos job runs, with publish-npm taking the macOS packages only from it.
11. **Windows signing (optional).** Without it `browse.exe` is unsigned and Windows Smart App Control blocks it, so
    install fails there. To sign with Azure Trusted Signing (now Artifact Signing): a signing account and certificate
    profile; an Azure identity with the **Artifact Signing Certificate Profile Signer** role (formerly Trusted Signing
    Certificate Profile Signer) on the account or profile and read access to the subscription; and a federated
    credential on that identity for this repository's `release` environment (issuer
    `https://token.actions.githubusercontent.com`, subject `repo:anomalyco/browse:environment:release`, audience
    `api://AzureADTokenExchange`). Then the six repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
    `AZURE_SUBSCRIPTION_ID`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME` and
    `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`, and `gh variable set WINDOWS_SIGNING --body true`: the sign-windows
    job signs every `browse.exe` in the Windows tarballs over OIDC (no secret), checks each signature and repacks them,
    and publish-npm and the release service take the Windows packages only from it. macOS and Windows signing are
    independent; either, both or neither can be on.

## Secrets

Release secrets live in AWS Secrets Manager (account `anomaly-secrets`), managed from
[anomalyco/secrets](https://github.com/anomalyco/secrets). A job that needs one runs in the `release` environment and
assumes `role/github/browse-release` with its GitHub OIDC token, fetching only the secrets it uses; the role's trust
requires that environment, and it can read `browse/release/*` and `shared/APPLE_SIGNING_CERTIFICATE`. Set a value with
`bun set browse release <NAME>` in that repo; no release secret is stored in GitHub. npm needs none (trusted
publishing).

| Secret | Use |
| --- | --- |
| `browse/release/RELEASE_TAG_KEY` | the release deploy key: `tag` pushes `v<version>`, `push-release-to-dev` pushes the release commit |
| `browse/release/AMO_API_KEY`, `browse/release/AMO_API_SECRET` | `web-ext sign` for the Firefox add-on (also used by hand; addons.mozilla.org's Developer Hub rotates them) |
| `shared/APPLE_SIGNING_CERTIFICATE` | `sign-macos`, when the repository variable `MACOS_SIGNING` is true |

The signing switches (`MACOS_SIGNING`, `WINDOWS_SIGNING`) and the Azure ids the Windows signer logs in with are
repository variables, not secrets.


## Undoing a bad release

- **npm.** npm users move forward, so release a fixed patch. `npm deprecate @opencode/browse@<bad> "<why>"`
  warns new installs; a user can rerun the installer with `--version <good>` (which installs from npm) to go back.
- **Firefox add-on.** Upload a fixed version; AMO doesn't let a version be replaced once it is public, so bump it.
  A version still in review can be cancelled in the Developer Hub, and an unlisted build can simply be replaced
  locally by the older signed `.xpi`.
- **Release service.** Binary installs follow the channel's current release: `promote` an earlier release with
  `client.sh action ... --action promote` (anomalyco/release docs/publishing.md), or publish a fixed patch. Because
  versions are never ordered, promoting the earlier one is a rollback even though its version is lower.

## Compatibility between the extension and the CLI

The add-on and the CLI update independently, so either can be ahead for an hour or so; a dev install's add-on moves
with its CLI. The relay accepts extension protocols from `minExtensionProtocolVersion` to
`extensionProtocolVersion` (`cli/src/protocol.ts`). Bump `extensionProtocolVersion` only for a change an older relay
can't handle, and raise the minimum only when dropping older extensions. When they don't match, the status page,
`status` and tool errors name the side that's behind.
