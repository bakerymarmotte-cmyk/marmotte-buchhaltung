import { db } from "./firebase-config.js";
import {
  collection, query, where, getDocs, doc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { chf, parseChf, toInput, esc, isoDate, deDate } from "./geld.js";
import { toast } from "./ui.js";

// Die drei Werte pro Tag und Kasse
const FELDER = [
  { key: "brutto", label: "Tagesumsatz Brutto" },
  { key: "sumup",  label: "Tagesumsatz SumUp" },
  { key: "bank",   label: "Einzahlung Bank" },
];

// Ein Eintrag pro Kasse und Tag. Die Dokument-ID ist fest: <kasseId>_<YYYY-MM-DD>
// So kann es pro Tag und Kasse nie zwei Einträge geben, und Speichern überschreibt einfach.
const docId = (kasseId, datum) => `${kasseId}_${datum}`;

export function initErfassen(session) {
  let kassen = [];
  let vorhanden = {}; // kasseId → gespeicherter Eintrag für den gewählten Tag
  let laedt = false;
  let ersterLadevorgang = true;

  const tagEl = document.getElementById("tag");
  const listEl = document.getElementById("erfassen-list");
  const errorEl = document.getElementById("erfassen-error");
  const saveBar = document.getElementById("save-bar");
  const saveBtn = document.getElementById("erfassen-speichern");

  tagEl.value = isoDate();
  tagEl.max = isoDate();

  function verschiebeTag(delta) {
    const [y, m, d] = tagEl.value.split("-").map(Number);
    const neu = new Date(y, m - 1, d + delta);
    if (isoDate(neu) > isoDate()) return; // nicht in die Zukunft
    tagEl.value = isoDate(neu);
    ladeTag();
  }
  document.getElementById("tag-zurueck").addEventListener("click", () => verschiebeTag(-1));
  document.getElementById("tag-vor").addEventListener("click", () => verschiebeTag(1));
  tagEl.addEventListener("change", ladeTag);

  async function ladeTag() {
    if (!tagEl.value) return;
    document.getElementById("tag-label").textContent = deDate(tagEl.value);
    laedt = true;
    errorEl.textContent = "";
    try {
      const snap = await getDocs(query(collection(db, "tagesabschluesse"), where("datum", "==", tagEl.value)));
      vorhanden = {};
      snap.docs.forEach((d) => { vorhanden[d.data().kasseId] = d.data(); });
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Daten für diesen Tag konnten nicht geladen werden.";
    } finally {
      laedt = false;
      render();
    }
  }

  function render() {
    const aktive = kassen.filter((k) => k.active !== false || vorhanden[k.id]);
    document.getElementById("keine-kassen").style.display = aktive.length ? "none" : "block";
    saveBar.style.display = aktive.length ? "block" : "none";
    listEl.innerHTML = aktive
      .map((k) => {
        const v = vorhanden[k.id];
        return `
        <div class="card kasse-card" data-kasse="${k.id}">
          <div class="kc-head">
            <strong>${esc(k.name)}</strong>
            ${v ? '<span class="saved-badge"><i data-icon="circle-check" data-size="14"></i> gespeichert</span>' : ""}
          </div>
          ${FELDER.map((f) => `
            <label class="betrag-row">
              <span>${f.label}</span>
              <span class="betrag-input"><span class="cur">CHF</span>
                <input type="text" inputmode="decimal" data-feld="${f.key}" value="${toInput(v?.[f.key])}" placeholder="0.00">
              </span>
            </label>`).join("")}
        </div>`;
      })
      .join("");
    listEl.querySelectorAll("input").forEach((i) => i.addEventListener("focus", () => i.select()));
  }

  saveBtn.addEventListener("click", async () => {
    if (laedt) return;
    errorEl.textContent = "";
    const datum = tagEl.value;
    if (!datum) { errorEl.textContent = "Bitte ein Datum wählen."; return; }

    // Eingaben einlesen und prüfen
    const aktionen = [];
    for (const card of listEl.querySelectorAll(".kasse-card")) {
      const kasse = kassen.find((k) => k.id === card.dataset.kasse);
      const werte = {};
      let leer = true;
      for (const f of FELDER) {
        const r = parseChf(card.querySelector(`[data-feld="${f.key}"]`).value);
        if (Number.isNaN(r)) { errorEl.textContent = `${kasse.name}: «${f.label}» ist keine gültige Zahl.`; return; }
        if (r !== null) leer = false;
        werte[f.key] = r ?? 0;
      }
      if (leer) {
        if (vorhanden[kasse.id]) aktionen.push({ typ: "loeschen", kasse });
      } else {
        aktionen.push({ typ: "speichern", kasse, werte });
      }
    }
    if (!aktionen.length) { errorEl.textContent = "Es wurde nichts eingegeben."; return; }
    if (aktionen.some((a) => a.typ === "loeschen") &&
        !confirm("Bei mindestens einer Kasse sind alle Felder leer. Den bisher gespeicherten Eintrag für diesen Tag löschen?")) return;

    saveBtn.disabled = true;
    try {
      for (const a of aktionen) {
        const ref = doc(db, "tagesabschluesse", docId(a.kasse.id, datum));
        if (a.typ === "loeschen") {
          await deleteDoc(ref);
        } else {
          await setDoc(ref, {
            kasseId: a.kasse.id,
            kasseName: a.kasse.name,
            datum,
            ...a.werte,
            updatedAt: serverTimestamp(),
            updatedBy: session.profile.name || "",
          });
        }
      }
      toast(`${deDate(datum, false)} gespeichert`);
      await ladeTag();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.";
    } finally {
      saveBtn.disabled = false;
    }
  });

  return {
    setKassen(list) {
      kassen = list;
      if (ersterLadevorgang) { ersterLadevorgang = false; ladeTag(); } else render();
    },
  };
}
