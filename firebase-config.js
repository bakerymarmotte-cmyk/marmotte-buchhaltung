// Firebase-Konfiguration für Marmotte Buchhaltung
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBIrahlMfF3Z2jEZ4pcBpNreeYTYDhnx3A",
  authDomain: "marmotte-buchhaltung.firebaseapp.com",
  projectId: "marmotte-buchhaltung",
  storageBucket: "marmotte-buchhaltung.firebasestorage.app",
  messagingSenderId: "1066516830753",
  appId: "1:1066516830753:web:607b6cb05320fee6ed6160"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
