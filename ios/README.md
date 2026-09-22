# MYKITA JAPAN — iOS wrapper app

A thin native shell around the existing registration form + admin panel
(`index.html`), for internal/store-staff distribution (Ad Hoc or TestFlight
internal testing — not the public App Store). The HTML/CSS/JS is bundled
into the app itself (not fetched from GitHub Pages), so the form opens
instantly and works even with a flaky connection; only the actual
submit/admin network calls need connectivity, exactly as they do on the web
today.

This folder has the Swift source, the resources to bundle, and everything
needed to build entirely from **Terminal — no Xcode GUI required at any
step**. You still need Xcode.app installed (its SDKs and code-signing
tools are the only source of those on macOS — nothing else, including
Homebrew, can substitute), but you never have to open it. Edit the Swift
files in whatever editor you like (VS Code, etc.); `project.yml` +
[XcodeGen](https://github.com/yonaskolb/XcodeGen) generates the
`.xcodeproj` on demand, and the `Makefile` wraps the `xcodebuild` commands
for building, archiving, and exporting a signed `.ipa`.

(If you ever do want to open this in Xcode's GUI instead — e.g. to use the
debugger or Interface Builder-style previews — `make generate` still
produces a completely normal `MykitaWarranty.xcodeproj` you can just
double-click open. The two approaches aren't exclusive.)

## 1. One-time setup

```bash
xcode-select -p                        # confirm Xcode.app itself (not just
                                        # Command Line Tools) is selected —
                                        # should print .../Xcode.app/...
sudo xcodebuild -license accept        # if you haven't accepted it yet
brew install xcodegen
```

## 2. Generate the Xcode project

```bash
cd ios/MykitaWarranty
make generate
```

This reads `project.yml` and produces `MykitaWarranty.xcodeproj` (not
committed to git — regenerate it any time with this command; see
`.gitignore`). It already wires up all five Swift files, the bundled
`Resources/` folder (as a proper folder reference, so `index.html`'s
relative paths to `assets/` and `icons/` resolve — this replaces the
"drag in and choose Create folder references" step a GUI setup would
need), and `Assets.xcassets/AppIcon.appiconset`.

### Multi-store setup (Tokyo / Osaka / Fukuoka)

One app build serves all three stores. On first launch (no store saved
yet), `StorePickerView` asks which store the device belongs to and saves
the choice (`StoreSettings`, backed by `UserDefaults`) — from then on the
app opens straight to that store's form. Tapping the small store-name
badge in the top-right corner reopens the picker, for reassigning a device
later without reinstalling.

Each store needs its **own Google Sheet + Apps Script deployment**, same
as the existing single-store setup: copy the spreadsheet, paste
`apps-script.gs` into its Apps Script project, deploy as a Web App, and
get that store's `/exec` URL. Then fill in `Store.swift`'s `webhookURL`
for each case:

```swift
var webhookURL: String? {
    switch self {
    case .tokyo: return "https://script.google.com/macros/s/AKfycb.../exec"
    case .osaka: return "https://script.google.com/macros/s/AKfycb.../exec"
    case .fukuoka: return "https://script.google.com/macros/s/AKfycb.../exec"
    }
}
```

Mechanically: `WebView.swift` injects `window.MYKITA_STORE_WEBHOOK_URL` as
a `WKUserScript` (runs before the page's own script) using whichever
store's `webhookURL` `ContentView` passes it, and `index.html`'s
`SHEET_WEBHOOK_URL` line reads that global if present, falling back to its
own hardcoded default otherwise. The **web version** (GitHub Pages) never
sets that global, so nothing changes there — it always uses the default
URL regardless of this app's per-store config. A store left as `nil` in
`Store.swift` just falls back to that same default too, so you can fill
these in one at a time without breaking the others.

## 3. App icon

`Assets.xcassets/AppIcon.appiconset/icon-1024.png` is the existing PWA icon
(`MykitaWarranty/AppIcon-source-512.png`, originally 512×512 with no alpha
channel — good, since Apple's App Icon slot doesn't allow transparency),
nearest-neighbor upscaled to a real 1024×1024 file so the asset catalog
compiles (Xcode's `actool` hard-errors — not just warns — on a size
mismatch here; I wrote a small pure-Python PNG scaler for this since no
image tools were available in the environment I built this in). It's
functional but blurry up close, being a 2× pixel-doubled scale-up rather
than real high-resolution artwork. Before you actually distribute a build,
replace it with a proper 1024×1024 export from the original artwork if you
have it at higher res, keeping the same filename (or update the name in
that folder's `Contents.json` to match).

## 4. Build and run in the Simulator (no device/signing needed yet)

```bash
make sim
```

Builds, installs, and launches the app in the iOS Simulator — good for
checking the multi-store picker, layout, etc. before dealing with a real
device or code signing at all. `SIM_NAME` defaults to "iPhone 16"; override
with e.g. `make sim SIM_NAME="iPhone 15"` to match a Simulator you actually
have installed (Xcode → Settings → Platforms, or `xcrun simctl list
devices` to see what's available).

## 5. Build for a real device / distribute, for internal-only use

Since this is staff-only (not the App Store), sign with your Apple
Developer Program team:

```bash
make archive TEAM_ID=YOUR_TEAM_ID     # signed .xcarchive, device build
make ipa TEAM_ID=YOUR_TEAM_ID          # → build/ipa/MykitaWarranty.ipa
```

(Find your Team ID at developer.apple.com → Membership, or omit `TEAM_ID`
and instead fill in `DEVELOPMENT_TEAM` directly in `project.yml` once so
you don't have to pass it every time.)

`ExportOptions.plist`'s `method` defaults to `development` (installs on
devices registered to your team — simplest for a handful of store
devices; register each device's UDID at developer.apple.com first). For
wider internal distribution without physically cabling every device,
change `method` to `ad-hoc` in `ExportOptions.plist` and distribute the
resulting `.ipa` via a service like Diawi, or set up **TestFlight internal
testing** instead (up to 100 people on your team, no App Review for
internal testers) — TestFlight is usually the easier ongoing workflow if
staff already have Apple IDs added to your Developer team; uploading to it
still goes through `xcodebuild -exportArchive` with `method: app-store`
plus `xcrun altool` (or `xcrun notarytool`/Transporter) to actually upload,
which I can help script once you're at that stage.

## What I could not verify (please test on-device and report back)

I wrote and reasoned through this carefully, but I'm working in a Linux
environment with no Xcode/Simulator/device access, so none of this has
actually been built or run. Please build it on your Mac and check:

0. **`make generate` / `make sim` themselves** — I validated `project.yml`
   as well-formed YAML and dry-ran the `Makefile`'s recipes (`make -n`) to
   confirm the commands they'd run are what I intended, but I have neither
   `xcodegen` nor `xcodebuild` available here, so I couldn't actually
   generate the `.xcodeproj` or build it. If `xcodegen generate` errors,
   paste me the message — XcodeGen's errors are usually specific enough
   (a bad path, an unrecognized key) that I can fix `project.yml` directly.
1. **SMS compose** (prospect registration's "Send SMS" button, and the
   admin panel's SMS Message modal → Open SMS) — should hand off to the
   Messages app pre-filled. This is the most standard case and most likely
   to just work.
2. **Admin "Open Link"** (the 🔗 icon → Open Link on a prospect row) —
   should open the confirm page in Safari.
3. **Admin "Download CSV"** — the trickiest one. WKWebView's download
   handling (`WKDownloadDelegate`) is what I used, but exactly when a
   `<a download>` + Blob click is recognized as a "download" varies by iOS
   version in ways I can't fully verify without a device. If it doesn't
   trigger the share sheet, tell me what happens (nothing at all? an error
   in Safari's Web Inspector via the `isInspectable` debug connection?) and
   I'll adjust.
4. **Clipboard copy** (Copy Email / Copy Link / Copy SMS Message /
   Compose Mail's Copy Image) — `navigator.clipboard` calls from JS should
   work since `file://` is treated as a secure context, but worth
   confirming on-device, especially the image copy (Compose Mail modal).
5. **Store picker / badge** — first launch should show the picker
   full-screen with no way to skip it; after picking a store, the badge in
   the top-right corner should reopen the picker and switching stores
   there should actually reload the page against the new store's URL
   (check a test submission lands in the right spreadsheet). Also confirm
   the badge doesn't visually collide with the page's own language
   switcher (EN/JA/ZH/KO) in the top-left — I couldn't check this on a
   real screen size/notch.
6. **Submit timeout** — `SUBMIT_TIMEOUT_MS` (index.html, 15 seconds) aborts
   a hung submission and shows "Submission timed out…" instead of leaving
   the button stuck on "…" indefinitely. Tested against a browser with a
   simulated hung request (confirmed it fires at ~15s with the right
   message and re-enables the button); worth a real spot-check on-device
   with poor connectivity if you get the chance, but this part is shared
   with the web version so it's lower-risk than the iOS-only items above.

If any of these misbehave, the `isInspectable = true` line in
`WebView.swift` lets you attach Safari's Web Inspector to the running app
(Mac's Safari → Develop menu → your device/simulator name) to see console
errors — that'll make it much faster for us to fix together.
