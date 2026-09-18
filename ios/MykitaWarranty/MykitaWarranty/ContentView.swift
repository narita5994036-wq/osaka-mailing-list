import SwiftUI

struct ContentView: View {
    @State private var selectedStore: Store? = StoreSettings.selected
    @State private var showStorePicker = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let selectedStore {
                // index.html has no env(safe-area-inset-*) CSS of its own
                // (checked — it wasn't built expecting to render under the
                // status bar/notch), so this deliberately does NOT
                // ignoresSafeArea(): SwiftUI's default inset keeps the
                // page's own top bar (language switcher) and bottom content
                // clear of system UI, the same way it already renders in
                // Safari/as an installed PWA.
                WebView(webhookURL: selectedStore.webhookURL)

                storeBadge(for: selectedStore)
            }
        }
        // First launch (no store saved yet), and any time the badge above
        // is tapped to reassign this device to a different store.
        .fullScreenCover(isPresented: Binding(
            get: { showStorePicker || selectedStore == nil },
            set: { showStorePicker = $0 }
        )) {
            StorePickerView(currentSelection: selectedStore) { store in
                StoreSettings.selected = store
                selectedStore = store
                showStorePicker = false
            }
        }
    }

    private func storeBadge(for store: Store) -> some View {
        Button {
            showStorePicker = true
        } label: {
            Text(store.displayName)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(.thinMaterial, in: Capsule())
        }
        .padding(.top, 6)
        .padding(.trailing, 12)
    }
}

#Preview {
    ContentView()
}
