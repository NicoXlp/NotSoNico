// ─────────────────────────────────────────────────────────────────────────────
//  Firebase-Konfiguration (optional)
//
//  Ohne Konfiguration läuft das Vermietertagebuch im LOKALEN MODUS:
//  alle Daten bleiben nur auf diesem einen Gerät.
//
//  Damit alle Mitbewohner:innen dieselben Daten sehen, trage hier die
//  Web-Konfiguration eures Firebase-Projekts ein (Anleitung in README.md).
//  Alternativ kann die Konfiguration auch direkt in der App unter
//  „Haus → Synchronisierung“ eingefügt werden.
//
//  Beispiel:
//  export const FIREBASE_CONFIG = {
//    apiKey: "AIza...",
//    authDomain: "vermietertagebuch.firebaseapp.com",
//    projectId: "vermietertagebuch",
//    storageBucket: "vermietertagebuch.appspot.com",
//    messagingSenderId: "1234567890",
//    appId: "1:1234567890:web:abcdef"
//  };
// ─────────────────────────────────────────────────────────────────────────────

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB3RbK1rJGamJWPNJGFhFsZ6Ahl42Lzavw",
  authDomain: "vermietertagebuch-d258b.firebaseapp.com",
  projectId: "vermietertagebuch-d258b",
  storageBucket: "vermietertagebuch-d258b.firebasestorage.app",
  messagingSenderId: "601016232351",
  appId: "1:601016232351:web:3396b5685b280c55dfb5aa"
};

// ─────────────────────────────────────────────────────────────────────────────
//  Push-Benachrichtigungen (optional, Anleitung in README.md → „Push“)
//  Öffentlicher VAPID-Schlüssel, erzeugt mit:  npx web-push generate-vapid-keys
//  Der PRIVATE Schlüssel gehört NICHT hierher, sondern als Secret zu GitHub.
// ─────────────────────────────────────────────────────────────────────────────

export const VAPID_PUBLIC_KEY = null;
