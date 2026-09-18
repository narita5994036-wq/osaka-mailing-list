# MYKITA JAPAN — iOS wrapper app

A thin native shell around the existing registration form + admin panel
(`index.html`), for internal/store-staff distribution (Ad Hoc or TestFlight
internal testing — not the public App Store). The HTML/CSS/JS is bundled
into the app itself (not fetched from GitHub Pages), so the form opens
instantly and works even with a flaky connection; only the actual
submit/admin network calls need connectivity, exactly as they do on the web
today.

This folder has the Swift source and the resources to bundle — not a
`.xcodeproj`. Hand-writing Xcode's project file reliably without being able
to open it in Xcode myself isn't safe (a bad `.pbxproj` shows up as "cannot
open a project with a missing or damaged file", and I can't verify it), so
the steps below have you create the project shell in Xcode (a few clicks)
and then drop these files in.

## 1. Create the project

1. Xcode → File → New → Project → **iOS → App**.
2. Product Name: `MykitaWarranty`. Interface: **SwiftUI**. Language: **Swift**.
3. Uncheck "Include Tests" (not needed for this).
4. Save it at `ios/` inside this repo — i.e. so the result is
   `ios/MykitaWarranty/MykitaWarranty.xcodeproj`. Xcode will create a
   `MykitaWarranty/MykitaWarranty/` source folder next to it, matching the
   layout already in this repo.

## 2. Replace/add the source files

Xcode's template already created `MykitaWarrantyApp.swift` and
`ContentView.swift` — delete those two (Move to Trash) and drag in these
five files from this repo instead (check "Copy items if needed" is **off**
if you want them to stay tracked at their current path, or **on** if you'd
rather Xcode own a copy — either works, just be consistent with git):

- `MykitaWarranty/MykitaWarrantyApp.swift`
- `MykitaWarranty/ContentView.swift`
- `MykitaWarranty/WebView.swift`
- `MykitaWarranty/Store.swift`
- `MykitaWarranty/StorePickerView.swift`

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

## 3. Add the bundled web content

Drag the `MykitaWarranty/Resources/` folder (from this repo, the one
containing `index.html`, `assets/`, `icons/`) into the Xcode project
navigator, next to the Swift files.

**Important:** when Xcode asks, choose **"Create folder references"**, not
"Create groups". A folder reference (shown in blue in Xcode) preserves the
`Resources/assets/...` and `Resources/icons/...` subfolder structure at
runtime, which `WebView.swift` and `index.html`'s relative paths both
depend on — a plain group would flatten everything into the bundle root and
break the image references.

## 4. App icon

`MykitaWarranty/AppIcon-source-512.png` is the existing 512×512 PWA icon —
not a ready-made asset catalog entry, just a source image to drag into
Xcode's own auto-generated `Assets.xcassets → AppIcon` slot (Xcode 14+
projects use a single 1024×1024 slot; it'll scale down for you). It's too
small and (likely) has transparency, which Apple's App Icon slot doesn't
allow — before you distribute a build, replace it with a proper
**1024×1024, no alpha channel** icon (export one from the original artwork
if you have it at higher res; I couldn't resize it myself in this
environment — no image tools available here).

## 5. A few target settings worth setting explicitly

In the target's **Info** tab (or General → Deployment Info):
- **Display Name**: `MYKITA JAPAN` (matches `manifest.json`'s `short_name`)
- **Supported interface orientations**: Portrait only (the web layout is a
  fixed-width mobile form; landscape isn't designed for)
- **iOS Deployment Target**: 15.0 or later (needed for `WKDownloadDelegate`,
  used for the admin panel's CSV export — see `WebView.swift`)

## 6. Signing, for internal-only distribution

Since this is staff-only (not the App Store):
- **Xcode → Signing & Capabilities**: sign with your Apple Developer Program
  team, automatic signing is fine.
- Distribute via **Ad Hoc** (register store devices' UDIDs, export an .ipa,
  install via Apple Configurator or a service like TestFlight/Diawi) or
  **TestFlight internal testing** (up to 100 people on your team, no App
  Review needed for internal testers) — TestFlight internal is usually the
  easier ongoing workflow if staff already have Apple IDs added to your
  Developer team.

## What I could not verify (please test on-device and report back)

I wrote and reasoned through this carefully, but I'm working in a Linux
environment with no Xcode/Simulator/device access, so none of this has
actually been built or run. Please build it on your Mac and check:

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
