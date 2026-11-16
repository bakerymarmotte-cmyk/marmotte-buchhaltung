import { db } from "./firebase-config.js";
import {
  collection, getDocs, doc, setDoc, updateDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Einmalige Umstellung auf Standorte:
// Alles, was vor der Umstellung erfasst wurde, gehört zu Kandersteg.
// Reihenfolge: Standort → Kassen → Tagesabschlüsse → Bank → Monatsabschlüsse → fertig markieren.
// Bricht es ab, kann man einfach nochmals starten.

const ALT_TAG = /^\d{4}-\d{2}-\d{2}$/;  // alte Bank-ID: nur Datum
const ALT_MONAT = /^\d{4}-\d{2}$/;      // alte Monatsabschluss-ID: nur Monat

/** Gibt es noch Daten ohne Standort? (nur aus bereits geladenen Daten) */
export function altdatenVorhanden(standorte, kassen, abschlussDocs) {
  return kassen.some((k) => !k.standortId) ||
    abschlussDocs.some((a) => ALT_MONAT.test(a.id)) ||
    standorte.some((s) => s.umgestellt === false);
}

export async function altdatenUebernehmen(melde = () => {}) {
  let n = 0;

  // 1. Standort Kandersteg (bestehender wird verwendet)
  melde("Standort Kandersteg …");
  const standorte = (await getDocs(collection(db, "standorte"))).docs;
  let sid = standorte.find((d) => (d.data().name || "").trim().toLowerCase() === "kandersteg")?.id;
  if (!sid) {
    sid = "kandersteg";
    await setDoc(doc(db, "standorte", sid), { name: "Kandersteg", active: true, umgestellt: false, createdAt: serverTimestamp() });
  } else {
    await updateDoc(doc(db, "standorte", sid), { umgestellt: false });
  }

  // 2. Kassen
  melde("Kassen …");
  for (const d of (await getDocs(collection(db, "kassen"))).docs) {
    if (d.data().standortId) continue;
    await updateDoc(d.ref, { standortId: sid });
    n++;
  }

  // 3. Tagesabschlüsse
  const ta = (await getDocs(collection(db, "tagesabschluesse"))).docs.filter((d) => !d.data().standortId);
  for (let i = 0; i < ta.length; i++) {
    melde(`Tagesabschlüsse ${i + 1} von ${ta.length} …`);
    await updateDoc(ta[i].ref, { standortId: sid });
    n++;
  }

  // 4. Bankeinzahlungen: neue ID <standort>_<datum>, alte löschen
  const tb = (await getDocs(collection(db, "tagesbank"))).docs.filter((d) => ALT_TAG.test(d.id));
  for (let i = 0; i < tb.length; i++) {
    melde(`Bankeinzahlungen ${i + 1} von ${tb.length} …`);
    const alt = tb[i].data();
    await setDoc(doc(db, "tagesbank", `${sid}_${tb[i].id}`), { ...alt, datum: tb[i].id, standortId: sid });
    await deleteDoc(tb[i].ref);
    n++;
  }

  // 5. Monatsabschlüsse: neue ID <standort>_<monat>, Datum des Abschlusses bleibt
  melde("Monatsabschlüsse …");
  for (const d of (await getDocs(collection(db, "monatsabschluesse"))).docs) {
    if (!ALT_MONAT.test(d.id)) continue;
    const alt = d.data();
    await setDoc(doc(db, "monatsabschluesse", `${sid}_${d.id}`), {
      monat: d.id,
      standortId: sid,
      abgeschlossenAm: alt.abgeschlossenAm || serverTimestamp(),
      abgeschlossenVon: alt.abgeschlossenVon || "",
    });
    await deleteDoc(d.ref);
    n++;
  }

  // 6. Fertig
  await updateDoc(doc(db, "standorte", sid), { umgestellt: true });
  return n;
}
