import SwiftUI

struct ContentView: View {
    var body: some View {
        WebView()
            // The web page already accounts for iOS safe areas with its own
            // padding (it was built for "Add to Home Screen" standalone
            // mode), so let it draw edge-to-edge rather than double-inset.
            .ignoresSafeArea()
            .statusBarHidden(false)
    }
}

#Preview {
    ContentView()
}
