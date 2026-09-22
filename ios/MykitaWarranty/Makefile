# Terminal-only build workflow — no Xcode GUI required at any step. See
# ../README.md for the full explanation and prerequisites (Xcode.app must
# still be installed for its SDKs/toolchain, but never opened).
#
# Usage:
#   make generate          Regenerate MykitaWarranty.xcodeproj from project.yml
#   make sim                Build + install + launch in the iOS Simulator
#   make archive             Build a signed .xcarchive (device build)
#   make ipa TEAM_ID=XXXX     Export a distributable .ipa from that archive
#   make clean                Remove all generated/build output

SCHEME := MykitaWarranty
PROJECT := MykitaWarranty.xcodeproj
BUILD_DIR := build
ARCHIVE_PATH := $(BUILD_DIR)/MykitaWarranty.xcarchive
IPA_DIR := $(BUILD_DIR)/ipa
SIM_NAME ?= iPhone 17
SIM_APP_PATH := $(BUILD_DIR)/Build/Products/Debug-iphonesimulator/MykitaWarranty.app
SIM_BUNDLE_ID := com.mykita.warranty

.PHONY: generate sim archive ipa clean

generate:
	xcodegen generate

# Simulator apps don't run on a real device, so they don't need real code
# signing at all — CODE_SIGN_STYLE: Automatic (project.yml) otherwise tries
# to resolve a signing identity/team and fails the build when none is
# configured yet. archive/ipa below are unaffected and still sign for real.
sim: generate
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-destination 'platform=iOS Simulator,name=$(SIM_NAME)' \
		-derivedDataPath $(BUILD_DIR) \
		CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
		build
	xcrun simctl boot "$(SIM_NAME)" 2>/dev/null || true
	# "open -a Simulator" relies on Launch Services having indexed the app
	# by name, which a manually-installed (non-App-Store) Xcode that's
	# never been opened via Finder/GUI may not have done yet. The bundle's
	# exact path under Xcode.app has also moved between Xcode versions, so
	# search for it under the currently-selected Xcode rather than
	# hardcoding a path that may not match this version's layout.
	open "$$(find "$$(xcode-select -p)/.." -maxdepth 4 -iname 'Simulator.app' -print -quit)"
	xcrun simctl install booted "$(SIM_APP_PATH)"
	xcrun simctl launch booted $(SIM_BUNDLE_ID)

# Device build, signed — requires a real Apple Developer Program team and
# (for automatic signing) that team logged into Xcode's account settings at
# least once, or explicit signing settings. TEAM_ID is optional here if
# DEVELOPMENT_TEAM is already set in project.yml.
archive: generate
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-sdk iphoneos -configuration Release \
		-archivePath $(ARCHIVE_PATH) \
		$(if $(TEAM_ID),DEVELOPMENT_TEAM=$(TEAM_ID),) \
		archive

# Before running: edit ExportOptions.plist's teamID to your real Team ID
# (or pass it via TEAM_ID and this substitutes it automatically).
ipa: archive
	@if [ -n "$(TEAM_ID)" ]; then \
		sed 's/YOUR_TEAM_ID/$(TEAM_ID)/' ExportOptions.plist > $(BUILD_DIR)/ExportOptions.plist; \
	else \
		cp ExportOptions.plist $(BUILD_DIR)/ExportOptions.plist; \
	fi
	xcodebuild -exportArchive \
		-archivePath $(ARCHIVE_PATH) \
		-exportPath $(IPA_DIR) \
		-exportOptionsPlist $(BUILD_DIR)/ExportOptions.plist
	@echo "Signed .ipa: $(IPA_DIR)"

clean:
	rm -rf $(BUILD_DIR) $(PROJECT) Generated
