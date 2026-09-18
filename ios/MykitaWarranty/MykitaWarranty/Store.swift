import Foundation

/// One retail location, each with its own Google Sheet / Apps Script
/// deployment. A device is set up once (via StorePickerView) and stays on
/// that store; MYKITA_STORE_WEBHOOK_URL is injected into the bundled web
/// app so its submissions land in the right spreadsheet — see
/// index.html's SHEET_WEBHOOK_URL and ios/README.md.
enum Store: String, CaseIterable, Identifiable {
    case tokyo
    case osaka
    case fukuoka

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .tokyo: return "Tokyo"
        case .osaka: return "Osaka"
        case .fukuoka: return "Fukuoka"
        }
    }

    /// TODO: replace each placeholder with that store's actual Apps Script
    /// Web App /exec URL (Deploy > Manage deployments in that store's copy
    /// of the spreadsheet's Apps Script project). Until then this falls
    /// back to index.html's own default SHEET_WEBHOOK_URL, so an
    /// unconfigured store still works — it just shares the default store's
    /// spreadsheet rather than having its own.
    var webhookURL: String? {
        switch self {
        case .tokyo: return nil // "https://script.google.com/macros/s/.../exec"
        case .osaka: return nil
        case .fukuoka: return nil
        }
    }
}

/// Persists the device's chosen store across launches.
enum StoreSettings {
    private static let key = "com.mykita.warranty.selectedStore"

    static var selected: Store? {
        get {
            UserDefaults.standard.string(forKey: key).flatMap(Store.init(rawValue:))
        }
        set {
            UserDefaults.standard.set(newValue?.rawValue, forKey: key)
        }
    }
}
