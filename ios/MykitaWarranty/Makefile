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

sim: generate
	xcodebuild -project $(PROJECT) -scheme $(SCHEME) \
		-destination 'platform=iOS Simulator,name=$(SIM_NAME)' \
		-derivedDataPath $(BUILD_DIR) build
	xcrun simctl boot "$(SIM_NAME)" 2>/dev/null || true
	open -a Simulator
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
