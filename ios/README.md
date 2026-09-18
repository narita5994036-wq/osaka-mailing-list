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
three files from this repo instead (check "Copy items if needed" is **off**
if you want them to stay tracked at their current path, or **on** if you'd
rather Xcode own a copy — either works, just be consistent with git):

- `MykitaWarranty/MykitaWarrantyApp.swift`
- `MykitaWarranty/ContentView.swift`
- `MykitaWarranty/WebView.swift`

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

If any of these misbehave, the `isInspectable = true` line in
`WebView.swift` lets you attach Safari's Web Inspector to the running app
(Mac's Safari → Develop menu → your device/simulator name) to see console
errors — that'll make it much faster for us to fix together.
