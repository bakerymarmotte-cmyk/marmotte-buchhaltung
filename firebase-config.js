// Firebase-Konfiguration für Marmotte Buchhaltung
// ------------------------------------------------------------------
// HIER die Werte aus der Firebase-Konsole eintragen:
// Projekteinstellungen → Allgemein → "Meine Apps" → Web-App → SDK-Konfiguration
// ------------------------------------------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "HIER_EINTRAGEN",
  authDomain: "marmotte-buchhaltung.firebaseapp.com",
  projectId: "marmotte-buchhaltung",
  storageBucket: "marmotte-buchhaltung.firebasestorage.app",
  messagingSenderId: "HIER_EINTRAGEN",
  appId: "HIER_EINTRAGEN"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
