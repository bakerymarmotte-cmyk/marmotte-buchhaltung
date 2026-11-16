import { requireSession, logout } from "./session.js";
import { db } from "./firebase-config.js";
import {
  collection, onSnapshot, query, where, doc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initErfassen } from "./erfassen.js";
import { initUebersicht } from "./uebersicht.js";
import { initKassen } from "./kassen.js";
import { initTeam } from "./team.js";
import { altdatenVorhanden, altdatenUebernehmen } from "./umstellung.js";
import { esc } from "./geld.js";
import { toast } from "./ui.js";

// Rollen:
//   admin    – alle Standorte, Kassen, Team, Monatsabschluss, Drucken
//   standort – nur der eigene Standort: Erfassen und Übersicht ansehen
const MERKER = "buchhaltung-standort";

async function start() {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return; // requireSession hat bereits umgeleitet
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  const rolle = session.profile.role;

  if (rolle !== "admin" && !(rolle === "standort" && session.profile.standortId)) {
    document.querySelector("main").innerHTML =
      '<div class="card form-card" style="margin-top:24px;"><h3 class="section-title">Kein Zugriff</h3>' +
      '<p class="hint-text">Dieses Konto hat keinen Zugriff auf die Buchhaltung.</p></div>';
    document.querySelector(".nav-wrap").style.display = "none";
    return;
  }

  const isAdmin = rolle === "admin";
  document.body.classList.toggle("is-admin", isAdmin);
  document.getElementById("user-name-label").textContent = session.profile.name || "";
  setupNav();

  const erfassen = initErfassen(session);
  const uebersicht = initUebersicht(session, { isAdmin });
  const kassenVerwaltung = isAdmin ? initKassen() : null;
  const team = isAdmin ? initTeam(session) : null;

  let standorte = [];      // [{id, name}]
  let kassenAlle = [];     // alle geladenen Kassen
  let abschlussDocs = [];  // alle geladenen Monatsabschlüsse
  let aktSid = isAdmin ? merkerLesen() : session.profile.standortId;
  let standorteGeladen = false;

  const wahlEl = document.getElementById("standort-wahl");
  const nameEl = document.getElementById("standort-name");

  // ---------- Daten an die Bereiche verteilen ----------
  function standortName(sid) { return standorte.find((s) => s.id === sid)?.name || ""; }

  function verteilen() {
    if (!standorteGeladen) return;
    // Admin: gewählten Standort prüfen, sonst den ersten nehmen
    if (isAdmin && !standorte.some((s) => s.id === aktSid)) aktSid = standorte[0]?.id || null;
    standortAnzeige();

    const kassen = kassenAlle.filter((k) => k.standortId === aktSid).sort((a, b) => a.name.localeCompare(b.name));
    const map = {};
    abschlussDocs.filter((a) => a.standortId === aktSid).forEach((a) => { map[a.monat] = a; });

    if (!erfassen.setStandort(aktSid, standortName(aktSid))) {
      // Wechsel abgebrochen (ungespeicherte Eingaben) – Auswahl zurücksetzen
      aktSid = erfassen.standortId();
      standortAnzeige();
      return;
    }
    erfassen.setKassen(kassen);
    erfassen.setAbschluesse(map);
    uebersicht.setStandort(aktSid, standortName(aktSid));
    uebersicht.setKassen(kassen);
    uebersicht.setAbschluesse(map);
  }

  function standortAnzeige() {
    if (isAdmin) {
      wahlEl.innerHTML = standorte.length
        ? standorte.map((s) => `<option value="${s.id}">${esc(s.name)}${s.active === false ? " (inaktiv)" : ""}</option>`).join("")
        : '<option value="">– noch kein Standort –</option>';
      wahlEl.value = aktSid || "";
      wahlEl.style.display = "";
      nameEl.style.display = "none";
    } else {
      nameEl.textContent = standortName(aktSid) || "…";
      wahlEl.style.display = "none";
      nameEl.style.display = "";
    }
  }

  wahlEl.addEventListener("change", () => {
    aktSid = wahlEl.value;
    merkerSchreiben(aktSid);
    verteilen();
  });

  const fehler = (was) => (err) => { console.error(err); toast(`${was} konnten nicht geladen werden.`); };

  // ---------- Live-Daten ----------
  if (isAdmin) {
    onSnapshot(collection(db, "standorte"), (snap) => {
      standorte = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
      standorteGeladen = true;
      kassenVerwaltung.setStandorte(standorte);
      team.setStandorte(standorte);
      verteilen();
      umstellungPruefen();
    }, fehler("Standorte"));

    onSnapshot(collection(db, "kassen"), (snap) => {
      kassenAlle = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      kassenVerwaltung.setKassen(kassenAlle);
      verteilen();
      umstellungPruefen();
    }, fehler("Kassen"));

    onSnapshot(collection(db, "monatsabschluesse"), (snap) => {
      abschlussDocs = snap.docs.map(abschlussLesen);
      verteilen();
      umstellungPruefen();
    }, fehler("Monatsabschlüsse"));
  } else {
    const sid = session.profile.standortId;
    onSnapshot(doc(db, "standorte", sid), (snap) => {
      standorte = snap.exists() ? [{ id: snap.id, ...snap.data() }] : [];
      standorteGeladen = true;
      verteilen();
    }, fehler("Standortdaten"));

    onSnapshot(query(collection(db, "kassen"), where("standortId", "==", sid)), (snap) => {
      kassenAlle = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      verteilen();
    }, fehler("Kassen"));

    onSnapshot(query(collection(db, "monatsabschluesse"), where("standortId", "==", sid)), (snap) => {
      abschlussDocs = snap.docs.map(abschlussLesen);
      verteilen();
    }, fehler("Monatsabschlüsse"));
  }

  // ---------- Einmalige Umstellung: bestehende Daten → Standort Kandersteg ----------
  const umstEl = document.getElementById("umstellung");
  function umstellungPruefen() {
    if (!isAdmin || !standorteGeladen) return;
    umstEl.style.display = altdatenVorhanden(standorte, kassenAlle, abschlussDocs) ? "block" : "none";
  }
  document.getElementById("umstellung-btn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (!confirm("Alle bestehenden Kassen, Tagesabschlüsse, Bankeinzahlungen und Monatsabschlüsse dem Standort «Kandersteg» zuordnen?")) return;
    btn.disabled = true;
    const status = document.getElementById("umstellung-status");
    try {
      const n = await altdatenUebernehmen((t) => { status.textContent = t; });
      status.textContent = "";
      toast(`Fertig: ${n} Einträge Kandersteg zugeordnet`);
      erfassen.neuLaden();
    } catch (err) {
      console.error(err);
      status.textContent = "Umstellung fehlgeschlagen. Sind die neuen Firestore-Regeln veröffentlicht? Einfach nochmals versuchen – bereits Umgestelltes bleibt.";
    } finally {
      btn.disabled = false;
    }
  });
}

function abschlussLesen(d) {
  const data = d.data({ serverTimestamps: "estimate" });
  const am = data.abgeschlossenAm?.toDate ? data.abgeschlossenAm.toDate() : new Date();
  return {
    id: d.id,
    ...data,
    datumText: am.toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}

function merkerLesen() {
  try { return localStorage.getItem(MERKER); } catch { return null; }
}
function merkerSchreiben(v) {
  try { localStorage.setItem(MERKER, v); } catch { /* egal */ }
}

function setupNav() {
  const buttons = document.querySelectorAll("#main-nav button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      document.body.dataset.tab = btn.dataset.tab;
      window.scrollTo(0, 0);
    });
  });
  document.body.dataset.tab = "erfassen";
}

start();
