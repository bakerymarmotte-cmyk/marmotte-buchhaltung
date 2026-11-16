import { db, firebaseConfig } from "./firebase-config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDocs, setDoc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./geld.js";
import { toast } from "./ui.js";

// Konten verwalten (nur Admin).
// Rolle «Standort»: sieht nur die Kassen und die Bank des zugewiesenen Standorts,
// darf erfassen und die Übersicht ansehen – nicht drucken, nicht abschliessen.
export function initTeam(session) {
  let standorte = [];
  const listEl = document.getElementById("team-list");
  const errorEl = document.getElementById("emp-error");
  const saveBtn = document.getElementById("emp-speichern");
  const rolleEl = document.getElementById("emp-rolle");
  const standortEl = document.getElementById("emp-standort");
  const standortFeld = document.getElementById("emp-standort-feld");
  let geladen = false;

  const standortName = (sid) => standorte.find((s) => s.id === sid)?.name || "?";

  function rolleAnzeigen() {
    standortFeld.style.display = rolleEl.value === "standort" ? "" : "none";
  }
  rolleEl.addEventListener("change", rolleAnzeigen);
  rolleAnzeigen();

  async function lade() {
    try {
      const snap = await getDocs(collection(db, "users"));
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.active === false) - (b.active === false) || (a.name || "").localeCompare(b.name || ""));
      listEl.innerHTML = users
        .map((u) => `
          <div class="list-item ${u.active === false ? "is-inactive" : ""}">
            <div class="li-main">
              <strong>${esc(u.name)}</strong>
              <span class="li-sub">${esc(u.email)} · ${u.role === "admin" ? "Admin" : u.role === "standort" ? `Standort ${esc(standortName(u.standortId))}` : "ohne Zugriff"}${u.active === false ? " · inaktiv" : ""}</span>
            </div>
            ${u.id === session.uid ? '<span class="li-sub">Du</span>' :
              `<button class="btn btn-secondary btn-small" data-toggle="${u.id}" data-active="${u.active !== false}">${u.active === false ? "Aktivieren" : "Deaktivieren"}</button>`}
          </div>`)
        .join("");
      listEl.querySelectorAll("[data-toggle]").forEach((b) =>
        b.addEventListener("click", async () => {
          const neu = b.dataset.active !== "true";
          try {
            await updateDoc(doc(db, "users", b.dataset.toggle), { active: neu });
            lade();
          } catch (err) {
            console.error(err);
            toast("Ändern fehlgeschlagen");
          }
        })
      );
    } catch (err) {
      console.error(err);
      listEl.innerHTML = '<p class="error-text">Konten konnten nicht geladen werden.</p>';
    }
  }

  // Erst laden, wenn der Tab geöffnet wird
  document.querySelector('[data-tab="team"]').addEventListener("click", () => {
    if (!geladen) { geladen = true; lade(); }
  });

  saveBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const name = document.getElementById("emp-name").value.trim();
    const email = document.getElementById("emp-email").value.trim();
    const password = document.getElementById("emp-password").value;
    const role = rolleEl.value;
    const standortId = standortEl.value;
    if (!name || !email) { errorEl.textContent = "Bitte Name und E-Mail ausfüllen."; return; }
    if (password.length < 8) { errorEl.textContent = "Das temporäre Passwort braucht mindestens 8 Zeichen."; return; }
    if (role === "standort" && !standortId) { errorEl.textContent = "Bitte einen Standort wählen."; return; }

    saveBtn.disabled = true;
    // Zweite Firebase-Instanz: so bleibt der Admin angemeldet, während das neue Konto erstellt wird
    const secondary = initializeApp(firebaseConfig, "Secondary-" + Date.now());
    const secondaryAuth = getAuth(secondary);
    try {
      const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
      const daten = { name, email, role, active: true, mustChangePassword: true, createdAt: serverTimestamp() };
      if (role === "standort") daten.standortId = standortId;
      await setDoc(doc(db, "users", cred.user.uid), daten);
      await signOut(secondaryAuth);
      ["emp-name", "emp-email", "emp-password"].forEach((id) => (document.getElementById(id).value = ""));
      toast(`${name} wurde erstellt`);
      lade();
    } catch (err) {
      console.error(err);
      errorEl.textContent = {
        "auth/email-already-in-use": "Diese E-Mail-Adresse wird bereits verwendet.",
        "auth/invalid-email": "Diese E-Mail-Adresse ist ungültig.",
        "auth/weak-password": "Das Passwort ist zu schwach.",
      }[err.code] || "Konto konnte nicht erstellt werden.";
    } finally {
      await deleteApp(secondary).catch(() => {});
      saveBtn.disabled = false;
    }
  });

  return {
    setStandorte(list) {
      standorte = list;
      const aktuell = standortEl.value;
      standortEl.innerHTML = list.length
        ? list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
        : '<option value="">– zuerst Standort anlegen –</option>';
      if (list.some((s) => s.id === aktuell)) standortEl.value = aktuell;
      if (geladen) lade();
    },
  };
}
