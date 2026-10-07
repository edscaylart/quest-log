# Shipping Quest Log on macOS without a paid Apple account

Research for [#8](https://github.com/edscaylart/quest-log/issues/8). Checked on 2026-10-07 against primary sources only (Apple, Tauri, Homebrew). Versions current on that date: macOS 27 "Golden Gate" (released [2026-09-14](https://developer.apple.com/news/releases/?id=09142026c)), Tauri 2.12.1 / tauri-bundler 2.10.1, `tauri-plugin-updater` 2.13.1, Homebrew 7.0.8.

## Answer

- **Build arm64 with an ad-hoc signature.** Set `bundle > macOS > signingIdentity` to `"-"` in `tauri.conf.json`. No certificate or Apple secrets are needed, and notarization is skipped on its own. Without this setting Tauri doesn't sign the bundle at all, and a downloaded copy can be rejected as "damaged". Ad-hoc signing gets the app past that, but it never makes it pass Gatekeeper.
- **Ship a DMG on GitHub Releases, with first-launch steps in the README.** The user drags the app to `/Applications` and tries to open it, which gets blocked. Within about an hour they go to **System Settings › Privacy & Security › Security › Open Anyway** and enter their password. They only do this once. Control-click → Open no longer works on macOS 15 and later. For terminal users, `xattr -dr com.apple.quarantine "/Applications/Quest Log.app"` is an unofficial alternative.
- **Homebrew is optional, and only a personal tap works.** `homebrew/cask` refuses apps that fail Gatekeeper, and those casks have been disabled since 2026-09-01. A tap like `edscaylart/homebrew-tap` skips that audit. But Homebrew still quarantines the download, so users still need Open Anyway, and `--no-quarantine` no longer exists.
- **Use the Tauri updater; it doesn't need Apple signing.** It checks its own minisign signature, which can't be turned off. The bundle it installs has no quarantine attribute, so users shouldn't be asked to approve the app again. There are three catches:
  - The app has to be moved out of the DMG or Downloads first, because of translocation.
  - Each ad-hoc-signed version counts as a new identity, so macOS forgets privacy (TCC) and Keychain permissions on every update.
  - Wait for the release after `tauri-plugin-updater` 2.13.1, which fixes a macOS install bug that can delete the app.
- **Building from source avoids Gatekeeper.** A locally built app isn't quarantined, so Gatekeeper never checks it. The linker's ad-hoc signature is enough for arm64.

---

## 1. Ad-hoc code signing for arm64 Tauri builds

### Apple's rule

- On Apple silicon, macOS won't run a native executable unless it is signed. Apple: "There isn't a specific identity requirement for this signature: a simple ad-hoc signature is sufficient." This doesn't apply to Rosetta-translated x86 code ([macOS Big Sur 11.0.1 Universal Apps release notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)).
- The toolchain (`clang`/`ld`, which `rustc` links through) signs executables automatically at link time. Those signatures "doesn't cover any resource other than the executable". They meet the Apple-silicon requirement on any Mac, "however … binaries signed this way cannot pass through Gatekeeper" ([same release notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)).

### What Tauri does by default

- `signingIdentity` is an optional field with no default ([`tauri-utils` config.rs L654-L656 @ tauri-v2.12.1](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/config.rs#L654-L656)). It can also come from the `APPLE_SIGNING_IDENTITY` env var ([Tauri docs: macOS code signing](https://v2.tauri.app/distribute/sign/macos/)).
- If there is no identity and no `APPLE_CERTIFICATE`, `keychain()` returns `None` ([sign.rs L19-L44](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-bundler/src/bundle/macos/sign.rs#L19-L44)). The bundler then skips the whole signing step and has no fallback branch ([app.rs L115-L148](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-bundler/src/bundle/macos/app.rs#L115-L148)).
- So by default, the only signature in the `.app` is the linker's signature on the main executable. Nothing seals `Info.plist` or the resources.
- Tauri's docs say signing is what avoids "a warning that your application is broken and can not be started, when downloaded from the browser" ([Tauri docs](https://v2.tauri.app/distribute/sign/macos/)).
- Apple says macOS reports the app "can't be opened" when it "detects that software has been modified or damaged" ([Apple: Safely open apps on your Mac](https://support.apple.com/en-us/102445)).
- Tauri's open issue [tauri-apps/tauri#8763](https://github.com/tauri-apps/tauri/issues/8763), "Use ad-hoc code signing on macOS if no certificate is available", tracks changing this default. It is still open as of 2026-10-07.

### Config needed

```jsonc
// src-tauri/tauri.conf.json
{
  "bundle": {
    "macOS": {
      "signingIdentity": "-"   // ad-hoc
      // "hardenedRuntime" defaults to true; leave it
    }
  }
}
```

- The Tauri docs recommend this: "If you do not wish to provide an Apple-authenticated identity, but still wish to sign your application, you can configure an ad-hoc signature … useful on ARM (Apple Silicon) devices, where code-signing is required for all apps from the Internet" ([Tauri docs](https://v2.tauri.app/distribute/sign/macos/)).
- With `"-"`, the bundler runs `codesign --force -s - [--options runtime]` ([tauri-macos-sign keychain.rs L207-L239](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-macos-sign/src/keychain.rs#L207-L239)).
- It signs from the inside out: frameworks and sidecars first, then the app ([app.rs L117-L132](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-bundler/src/bundle/macos/app.rs#L117-L132)).
- `hardenedRuntime` defaults to `true` ([config.rs L657-L659](https://github.com/tauri-apps/tauri/blob/tauri-v2.12.1/crates/tauri-utils/src/config.rs#L657-L659)).
- Notarization is attempted only when `APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID` or `APPLE_API_*` are set. Otherwise the bundler logs "skipping app notarization" and carries on ([app.rs L134-L148](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-bundler/src/bundle/macos/app.rs#L134-L148), [sign.rs `notarize_auth`](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-bundler/src/bundle/macos/sign.rs#L96-L150)).
- Ad-hoc signing does **not** avoid the user approval step. Tauri: "Ad-hoc code signing does not prevent MacOS from requiring users to whitelist the installation in their Privacy & Security settings" ([Tauri docs](https://v2.tauri.app/distribute/sign/macos/)).

## 2. Gatekeeper on Sequoia (15), Tahoe (26) and Golden Gate (27)

### What changed

- On 2024-08-06 Apple announced: "In macOS Sequoia, users will no longer be able to Control-click to override Gatekeeper when opening software that isn't signed correctly or notarized. They'll need to visit System Settings > Privacy & Security…" ([Apple Developer News: Updates to runtime protection in macOS Sequoia](https://developer.apple.com/news/?id=saqachfa)).
- By default, Gatekeeper accepts software from the App Store, or software "signed by a registered developer and notarized by Apple". Users can still override this "unless restricted by a device management service" ([Apple Platform Security: Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)).
- Gatekeeper runs when a quarantined app is launched: "running a quarantined app always invokes Gatekeeper." Apple doesn't document when else it runs ([Apple DTS, "Resolving Trusted Execution Problems"](https://developer.apple.com/forums/thread/706442)).

### Exact user steps

These are Apple's steps, and they're identical in the [Sequoia 15](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/15.0/mac/15.0), [Tahoe 26](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/26/mac/26) and [Golden Gate 27](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/27/mac/27) editions of the Mac User Guide:

1. Try to open the app (double-click). macOS blocks it.
2. Choose Apple menu > System Settings, then click **Privacy & Security** in the sidebar.
3. Go to **Security**, then click **Open Anyway**. Apple: "This button is available for about an hour after you try to open the app."
4. Enter the login password, then click OK.
5. Apple: "The app is saved as an exception to your security settings, and you can open it in the future by double-clicking it."

[Apple: Safely open apps on your Mac](https://support.apple.com/en-us/102445) (updated 2026-05-27) gives the same flow. It adds that "The warning prompt reappears", and the user then clicks **Open**.

### `xattr` (terminal alternative)

- Downloads are quarantined through the `com.apple.quarantine` extended attribute. That attribute "is not documented as API" ([Apple DTS](https://developer.apple.com/forums/thread/706442)).
- `xattr -d [-r] attr_name file` deletes an attribute, recursively with `-r` (`man xattr`, macOS).
- `xattr -dr com.apple.quarantine "/Applications/Quest Log.app"` therefore removes the trigger, and Gatekeeper isn't invoked at launch.
- Apple doesn't document this as a user procedure; its supported path is Open Anyway. Present it as an option for advanced users, not the main instructions.

### Translocation

- When needed, "Gatekeeper opens apps from randomized, read-only locations" ([Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)).
- Apple DTS says when this happens "is not documented and has changed over time". DTS believes "we only remove app translocation if the user moves the app using the Finder", and adds that this is "not something we officially document" ([Apple DTS forum reply, June 2023](https://developer.apple.com/forums/thread/732370)).
- Practical rule: the README must tell users to **drag the app to /Applications before the first launch**. That matters for the updater (section 4).

## 3. Homebrew

### `homebrew/cask` is not an option

- Homebrew 5.0.0 (2025-11-12): "Casks without codesigning are deprecated. We will disable all Homebrew/homebrew-cask casks that fail Gatekeeper checks in September 2026" ([Homebrew 5.0.0](https://brew.sh/2025/11/12/homebrew-5.0.0/)). 6.0.0 restated this ([Homebrew 6.0.0](https://brew.sh/2026/06/11/homebrew-6.0.0/)).
- Current policy: executable artefacts "must pass Homebrew's Gatekeeper checks and must not require System Integrity Protection or Gatekeeper to be disabled or bypassed" ([Acceptable Casks](https://docs.brew.sh/Acceptable-Casks)).
- Casks that fail Gatekeeper are deprecated, disabled and eventually removed, with the reason `:fails_gatekeeper_check` ([Deprecating, Disabling and Removing](https://docs.brew.sh/Deprecating-Disabling-and-Removing#when-to-deprecate-casks), [Security and Supply Chain: casks have a different trust model](https://docs.brew.sh/Homebrew-Security-and-Supply-Chain#casks-have-a-different-trust-model)).
- This is already being enforced: e.g. `disable! date: "2026-09-01", because: :fails_gatekeeper_check` in [`Casks/q/qutebrowser.rb`](https://github.com/Homebrew/homebrew-cask/blob/9f192b72c8957a7736d9bf2119a5f808a18fd13a/Casks/q/qutebrowser.rb#L13).
- `homebrew/core` is out too: "A formula whose primary output is a native macOS `.app` bundle is not eligible" ([Acceptable Formulae](https://docs.brew.sh/Acceptable-Formulae)).

### A personal tap avoids the audit, but not Gatekeeper

- The signing audit returns early for non-official taps unless `--signing` is passed: `return if !cask.tap&.official? && !signing?` ([cask/audit.rb L601-L612 @ 0ea8fa5](https://github.com/Homebrew/brew/blob/0ea8fa50d724bf17e94a604f902b9f8c67f6b229/Library/Homebrew/cask/audit.rb#L601-L612)). A cask in `edscaylart/homebrew-tap` can ship an ad-hoc-signed app.
- Tap repositories should be named `homebrew-<name>` ([How to Create and Maintain a Tap](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)).
- Homebrew still quarantines every cask download, whatever the tap ([cask/download.rb L78 and L254-L256](https://github.com/Homebrew/brew/blob/0ea8fa50d724bf17e94a604f902b9f8c67f6b229/Library/Homebrew/cask/download.rb#L254-L256)). Homebrew's docs: "Homebrew applies macOS quarantine attributes to Cask downloads so Gatekeeper performs these checks instead of Homebrew bypassing them" ([Security and Supply Chain](https://docs.brew.sh/Homebrew-Security-and-Supply-Chain#casks-have-a-different-trust-model)). Tap users therefore go through the same Open Anyway step as DMG users.
- Since 6.0.0, non-official taps must be trusted explicitly. Installing by full name, e.g. `brew install --cask edscaylart/tap/quest-log`, trusts that one item ([Tap Trust](https://docs.brew.sh/Tap-Trust)).
- If the app updates itself, the cask should declare `auto_updates true` ([Cask Cookbook](https://docs.brew.sh/Cask-Cookbook)). `brew upgrade` then skips it unless run with `--greedy` ([`brew` manpage](https://docs.brew.sh/Manpage)).

### Status of `--no-quarantine`: removed

- 5.0.0: deprecated. "--no-quarantine and --quarantine flags have been deprecated as Homebrew does not wish to easily provide circumvention to macOS security features" ([Homebrew 5.0.0](https://brew.sh/2025/11/12/homebrew-5.0.0/); [install.rb @ 5.0.0 L150-L153](https://github.com/Homebrew/brew/blob/5.0.0/Library/Homebrew/cmd/install.rb#L150-L153), `odeprecated: true`).
- 5.1.0: disabled, meaning using it is an error ([install.rb @ 5.1.0 L150-L153](https://github.com/Homebrew/brew/blob/5.1.0/Library/Homebrew/cmd/install.rb#L150-L153), `odisabled: true`).
- 6.0.0: the switch was deleted ([Homebrew/brew#22549 "Homebrew 6 deprecations"](https://github.com/Homebrew/brew/pull/22549)). Leftover code was removed in [#23363](https://github.com/Homebrew/brew/pull/23363) ("no longer available `--no-quarantine`"). The current manpage doesn't mention it.

### Upgrade behaviour worth knowing

- Homebrew carries the user's Gatekeeper approval across `brew upgrade`, but only "when the new app satisfies the old app's designated requirement" ([Homebrew/brew#23060](https://github.com/Homebrew/brew/pull/23060), [quarantine.rb L111-L117](https://github.com/Homebrew/brew/blob/0ea8fa50d724bf17e94a604f902b9f8c67f6b229/Library/Homebrew/cask/quarantine.rb#L111-L117)).
- For ad-hoc-signed code, Apple says the designated requirement is "tied to that specific version of the code" ([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)).
- *Inference (not tested):* each `brew upgrade` of an ad-hoc Quest Log will therefore ask for Open Anyway again. Letting the Tauri updater handle updates (with `auto_updates true`) avoids that.

## 4. Tauri updater without Apple signing

### It works, and its signature is required

- "Tauri's updater needs a signature to verify that the update is from a trusted source. This cannot be disabled." ([Tauri updater docs](https://v2.tauri.app/plugin/updater/))
- The keys come from `tauri signer generate`. The public key goes in config and the private key in `TAURI_SIGNING_PRIVATE_KEY` at build time. Losing the private key means "you will NOT be able to publish new updates to the users that have the app already installed" ([same](https://v2.tauri.app/plugin/updater/)).
- This is entirely separate from Apple code signing. The plugin downloads with `reqwest` and calls `verify_signature` with the minisign public key and the version-bound trusted comment before installing ([updater.rs L807-L845, L1634-L1658 @ updater-v2.13.1](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.13.1/plugins/updater/src/updater.rs#L807-L845)). It never calls `codesign`, `spctl` or anything Gatekeeper-related.
- On macOS the update artefact is `<App>.app.tar.gz` plus a `.sig`. Producing them requires `bundle.createUpdaterArtifacts: true` ([Tauri updater docs](https://v2.tauri.app/plugin/updater/)).

### How the macOS install works, and the gotchas

From [`install_inner` (macOS), updater.rs L1381-L1477](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.13.1/plugins/updater/src/updater.rs#L1381-L1477):

1. The plugin unpacks the tarball with the Rust `tar` crate into a temp dir.
2. It `rename`s the running `.app` to a backup in a temp dir, then `rename`s the new bundle into place.
3. On `PermissionDenied` it falls back to an AppleScript `do shell script … with administrator privileges`, which asks for an admin password.
4. It `touch`es the bundle.
5. The install path comes from the running executable's path ([L1534-L1562](https://github.com/tauri-apps/plugins-workspace/blob/updater-v2.13.1/plugins/updater/src/updater.rs#L1534-L1562)).

Gotchas:

- **No quarantine on updated bundles, so no repeat Gatekeeper prompt.**
  - Apple DTS: "Unix-y networking tools, like `curl` and `scp`, don't quarantine the files they download. Unix-y unarchiving tools, like `tar` and `unzip`, don't propagate quarantine" ([Apple DTS](https://developer.apple.com/forums/thread/706442)).
  - Whether an app quarantines the files it creates is controlled by its own `LSFileQuarantineEnabled` key ([Apple docs](https://developer.apple.com/documentation/bundleresources/information-property-list/lsfilequarantineenabled)). Tauri doesn't set that key in its generated `Info.plist` ([app.rs `create_info_plist`](https://github.com/tauri-apps/tauri/blob/tauri-bundler-v2.10.1/crates/tauri-bundler/src/bundle/macos/app.rs#L212)).
  - Homebrew maintainers describe the same thing from the outside: a self-updated version "carries no quarantine attribute at all. Such a version launches without any Gatekeeper prompt" ([Homebrew/brew#23556](https://github.com/Homebrew/brew/pull/23556)).
  - Apple doesn't spell this out for self-updaters, so see Open questions.
- **Translocation breaks updates.**
  - If the user launches the app straight from the DMG or `~/Downloads` and macOS translocates it, the executable path is the randomized read-only copy. The rename then fails ([Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web) on read-only randomized locations; updater code above).
  - The plugin has no translocation detection.
  - Fix: tell users to drag the app to `/Applications` first. The app could also detect a path containing `/AppTranslocation/` and warn, though DTS notes there is no supported detection API ([Apple DTS](https://developer.apple.com/forums/thread/732370)).
- **The macOS install can lose the app in 2.13.1.**
  - [plugins-workspace#3505](https://github.com/tauri-apps/plugins-workspace/issues/3505): a failed final rename (e.g. `EXDEV`) deletes the backup, and the app with it.
  - [#3506](https://github.com/tauri-apps/plugins-workspace/issues/3506): the updated bundle root ends up with mode `0700`.
  - Both are fixed by [#3578](https://github.com/tauri-apps/plugins-workspace/pull/3578), merged to `v2` on 2026-10-05, after the latest v2 release (`updater-v2.13.1`, 2026-09-29). Pin to the next 2.x release.
- **Every update resets TCC and Keychain identity.**
  - Apple: "Ad hoc signed code … has a DR but it's tied to that specific version of the code … macOS can't reliably track the identity of the code," so privacy grants like microphone access are asked for again on each version ([TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)). The same note covers unexpected Keychain authorization alerts.
  - Quest Log should avoid relying on TCC-protected APIs (Accessibility, Screen Recording, Automation) or Keychain ACLs, or accept a re-prompt after every update.
  - Keeping data in SQLite under Application Support isn't affected.
- **App Management protection (Ventura+) is documented for notarized apps.**
  - Apple: "Apps validly signed by the same developer account or team will continue to be able to update each other." Other modifiers are blocked unless allowed by `NSUpdateSecurityPolicy` ([WWDC22 "What's new in privacy"](https://developer.apple.com/videos/play/wwdc2022/10096/)).
  - That passage covers notarized apps. Apple doesn't document how it treats an ad-hoc app replacing itself; see Open questions.

## 5. Build from source

- Gatekeeper's check is triggered by the quarantine attribute, and only "user-level apps" add it to new downloads ([Apple DTS](https://developer.apple.com/forums/thread/706442)). Apple describes Gatekeeper as acting "when a user downloads and opens an app" ([Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)).
- An app built locally with `cargo`/`npm run tauri build` from a `git clone` is created by the toolchain, not downloaded, so it carries no quarantine attribute and doesn't hit the Gatekeeper prompt. You can check with `xattr -l path/to/Quest\ Log.app`.
- The arm64 signing requirement is met even without `signingIdentity`, because the linker's ad-hoc signature is "sufficient to comply with the new default code signing requirement" ([Big Sur 11.0.1 release notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)). Keep `"-"` anyway so local builds match releases.
- One caveat: Apple says XProtect checks "all software in macOS … for known malicious content the first time it's opened, regardless of how it arrived on the Mac" ([Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)). That's a malware scan, not a signature or notarization gate.

## Open questions

- **Updater and provenance tracking.** Apple says "Gatekeeper also tracks the provenance of files written by downloaded software" ([Apple Platform Security](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)). It doesn't document whether that makes Gatekeeper check a bundle that an approved, non-notarized app wrote over itself. The no-prompt claim in section 4 rests on Apple DTS (quarantine triggers Gatekeeper) and on Homebrew's observations, not on an Apple guarantee. **Check this with a real update on macOS 27 before the first release.**
- **App Management for ad-hoc apps.** Apple only documents App Management for notarized apps. Not confirmed: whether macOS 15–27 ever blocks an ad-hoc-signed app that replaces its own bundle in `/Applications`, or shows the "app wants to manage other apps" prompt.
- **Translocation clearing.** Apple DTS says moving the app with Finder clears translocation, but explicitly calls this undocumented. Not confirmed: whether the app stays non-translocated after "Open Anyway" when it's run without being moved.
- **Unsealed bundle: "damaged" vs "Open Anyway".** Not confirmed from an Apple source: whether a bundle signed only by the linker (Tauri's default) gets the "damaged" alert with no Open Anyway button on 15/26/27, rather than the normal alert. Tauri's docs and [tauri#8763](https://github.com/tauri-apps/tauri/issues/8763) suggest it does. Irrelevant if we set `signingIdentity: "-"`.
- **Stripping quarantine in a tap cask.** Not confirmed: whether a cask in a personal tap could strip quarantine in a `postflight` step under Homebrew 7's cask sandbox. Homebrew's policy is against "normalising a security bypass", so don't plan on it.
- **Re-approval on `brew upgrade`.** That every `brew upgrade` of an ad-hoc app asks for Open Anyway again is an inference from Homebrew's designated-requirement check and TN3127, not tested.
