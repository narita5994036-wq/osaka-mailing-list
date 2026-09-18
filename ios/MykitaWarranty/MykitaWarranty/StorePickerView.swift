import SwiftUI

/// Shown on first launch (no store saved yet), and again whenever the
/// store badge in ContentView is tapped, so a device can be reassigned to
/// a different store without reinstalling.
struct StorePickerView: View {
    let currentSelection: Store?
    let onSelect: (Store) -> Void

    var body: some View {
        VStack(spacing: 32) {
            VStack(spacing: 8) {
                Text("MYKITA JAPAN")
                    .font(.system(size: 22, weight: .semibold))
                    .kerning(4)
                Text("Select this device's store")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 48)

            VStack(spacing: 12) {
                ForEach(Store.allCases) { store in
                    Button {
                        onSelect(store)
                    } label: {
                        HStack {
                            Text(store.displayName)
                                .font(.body)
                                .foregroundStyle(.primary)
                            Spacer()
                            if store == currentSelection {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(Color(.secondarySystemBackground))
                    }
                }
            }
            .padding(.horizontal, 20)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemBackground))
    }
}

#Preview {
    StorePickerView(currentSelection: .osaka, onSelect: { _ in })
}
