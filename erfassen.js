import { db } from "./firebase-config.js";
import {
  collection, query, where, getDocs, getDoc, doc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { chf, parseChf, toInput, esc, isoDate, deDate } from "./geld.js";
import { toast } from "./ui.js";

// Werte pro Kasse und Tag
const FELDER = [
  { key: "brutto", label: "Tagesumsatz Brutto" },
  { key: "sumup",  label: "Tagesumsatz SumUp" },
];
const MAX_AUSZAHLUNGEN = 30;

// Ein Eintrag pro Kasse und Tag: tagesabschluesse/<kasseId>_<YYYY-MM-DD>
// Die Bankeinzahlung gibt es einmal pro Tag:  tagesbank/<YYYY-MM-DD>
const docId = (kasseId, datum) => `${kasseId}_${datum}`;

export function initErfassen(session) {
  let kassen = [];
  let vorhanden = {};      // kasseId → gespeicherter Eintrag für den gewählten Tag
  let bankVorhanden = null; // gespeicherte Bankeinzahlung des Tages
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
      const [snap, bankSnap] = await Promise.all([
        getDocs(query(collection(db, "tagesabschluesse"), where("datum", "==", tagEl.value))),
        getDoc(doc(db, "tagesbank", tagEl.value)),
      ]);
      vorhanden = {};
      snap.docs.forEach((d) => { vorhanden[d.data().kasseId] = d.data(); });
      bankVorhanden = bankSnap.exists() ? bankSnap.data() : null;
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Daten für diesen Tag konnten nicht geladen werden.";
    } finally {
      laedt = false;
      render();
    }
  }

  // ---------- Auszahlungen ----------
  function auszahlungZeile(a = {}) {
    return `
      <div class="ausz-row">
        <input type="text" class="ausz-text" maxlength="80" placeholder="Wofür? z.B. Einkauf Migros" value="${esc(a.text || "")}">
        <span class="betrag-input ausz-betrag"><span class="cur">CHF</span>
          <input type="text" inputmode="decimal" class="ausz-wert" value="${toInput(a.betrag)}" placeholder="0.00">
        </span>
        <button type="button" class="icon-btn ausz-weg" title="Auszahlung entfernen" aria-label="Auszahlung entfernen"><i data-icon="x" data-size="15"></i></button>
      </div>`;
  }

  function auszahlungTotalAnzeigen(card) {
    const el = card.querySelector(".ausz-total");
    if (!el) return;
    let sum = 0;
    card.querySelectorAll(".ausz-wert").forEach((i) => { const r = parseChf(i.value); if (r > 0) sum += r; });
    el.textContent = sum ? `Total ${chf(sum)}` : "";
  }

  // Bar-Tagesumsatz = Brutto − SumUp − Auszahlungen, wird beim Tippen laufend angezeigt
  function barAnzeigen(card) {
    const el = card.querySelector(".bar-wert");
    if (!el) return;
    const brutto = parseChf(card.querySelector('[data-feld="brutto"]').value);
    const sumup = parseChf(card.querySelector('[data-feld="sumup"]').value);
    if (brutto === null || Number.isNaN(brutto) || Number.isNaN(sumup)) { el.textContent = "–"; el.classList.remove("neg"); return; }
    let ausz = 0;
    card.querySelectorAll(".ausz-wert").forEach((i) => { const r = parseChf(i.value); if (r > 0) ausz += r; });
    const bar = brutto - (sumup || 0) - ausz;
    el.textContent = chf(bar);
    el.classList.toggle("neg", bar < 0);
  }

  function render() {
    const aktive = kassen.filter((k) => k.active !== false || vorhanden[k.id]);
    document.getElementById("keine-kassen").style.display = aktive.length ? "none" : "block";
    saveBar.style.display = aktive.length ? "block" : "none";

    const kassenHtml = aktive
      .map((k) => {
        const v = vorhanden[k.id];
        const mitAusz = k.auszahlungen === true || (v?.auszahlungen?.length > 0);
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
          ${mitAusz ? `
            <div class="ausz-block">
              <div class="ausz-head"><span>Auszahlungen</span><span class="ausz-total mono"></span></div>
              <div class="ausz-list">${(v?.auszahlungen || []).map(auszahlungZeile).join("")}</div>
              <button type="button" class="btn btn-secondary btn-small ausz-neu"><i data-icon="plus" data-size="14"></i> Auszahlung</button>
            </div>` : ""}
          <div class="bar-row"><span>Bar-Tagesumsatz <span class="bar-formel">(Brutto − SumUp${mitAusz ? " − Auszahlungen" : ""})</span></span><strong class="mono bar-wert"></strong></div>
        </div>`;
      })
      .join("");

    const bankHtml = aktive.length ? `
      <div class="card kasse-card bank-card">
        <div class="kc-head">
          <strong><i data-icon="banknote" data-size="16"></i> Bank</strong>
          ${bankVorhanden ? '<span class="saved-badge"><i data-icon="circle-check" data-size="14"></i> gespeichert</span>' : ""}
        </div>
        <label class="betrag-row">
          <span>Einzahlung Bank (ganzer Tag)</span>
          <span class="betrag-input"><span class="cur">CHF</span>
            <input type="text" inputmode="decimal" id="bank-wert" value="${toInput(bankVorhanden?.bank)}" placeholder="0.00">
          </span>
        </label>
      </div>` : "";

    listEl.innerHTML = kassenHtml + bankHtml;
    listEl.querySelectorAll(".kasse-card").forEach(auszahlungTotalAnzeigen);
    listEl.querySelectorAll(".kasse-card[data-kasse]").forEach(barAnzeigen);
  }

  // Ereignisse in der Liste (einmal registriert, gilt auch für neu gerenderte Elemente)
  listEl.addEventListener("focusin", (e) => { if (e.target.matches(".betrag-input input")) e.target.select(); });
  listEl.addEventListener("input", (e) => {
    if (e.target.matches(".ausz-wert")) auszahlungTotalAnzeigen(e.target.closest(".kasse-card"));
    if (e.target.matches("[data-feld], .ausz-wert")) barAnzeigen(e.target.closest(".kasse-card"));
  });
  listEl.addEventListener("click", (e) => {
    const neu = e.target.closest(".ausz-neu");
    if (neu) {
      const list = neu.parentElement.querySelector(".ausz-list");
      if (list.children.length >= MAX_AUSZAHLUNGEN) { toast(`Maximal ${MAX_AUSZAHLUNGEN} Auszahlungen pro Tag`); return; }
      list.insertAdjacentHTML("beforeend", auszahlungZeile());
      list.lastElementChild.querySelector(".ausz-text").focus();
      return;
    }
    const weg = e.target.closest(".ausz-weg");
    if (weg) {
      const card = weg.closest(".kasse-card");
      weg.closest(".ausz-row").remove();
      auszahlungTotalAnzeigen(card);
      barAnzeigen(card);
    }
  });

  saveBtn.addEventListener("click", async () => {
    if (laedt) return;
    errorEl.textContent = "";
    const datum = tagEl.value;
    if (!datum) { errorEl.textContent = "Bitte ein Datum wählen."; return; }

    // Eingaben einlesen und prüfen
    const aktionen = [];
    for (const card of listEl.querySelectorAll(".kasse-card[data-kasse]")) {
      const kasse = kassen.find((k) => k.id === card.dataset.kasse);
      const werte = {};
      let leer = true;
      for (const f of FELDER) {
        const r = parseChf(card.querySelector(`[data-feld="${f.key}"]`).value);
        if (Number.isNaN(r)) { errorEl.textContent = `${kasse.name}: «${f.label}» ist keine gültige Zahl.`; return; }
        if (r !== null) leer = false;
        werte[f.key] = r ?? 0;
      }

      const auszahlungen = [];
      for (const row of card.querySelectorAll(".ausz-row")) {
        const text = row.querySelector(".ausz-text").value.trim();
        const betrag = parseChf(row.querySelector(".ausz-wert").value);
        if (!text && betrag === null) continue; // leere Zeile ignorieren
        if (Number.isNaN(betrag) || betrag === null || betrag <= 0) {
          errorEl.textContent = `${kasse.name}: Auszahlung «${text || "ohne Text"}» braucht einen gültigen Betrag.`; return;
        }
        if (!text) { errorEl.textContent = `${kasse.name}: Bitte bei jeder Auszahlung angeben, wofür.`; return; }
        auszahlungen.push({ text, betrag });
      }
      if (auszahlungen.length) leer = false;
      werte.auszahlungen = auszahlungen;
      werte.auszahlungenTotal = auszahlungen.reduce((s, a) => s + a.betrag, 0);

      if (leer) {
        if (vorhanden[kasse.id]) aktionen.push({ typ: "loeschen", kasse });
      } else {
        aktionen.push({ typ: "speichern", kasse, werte });
      }
    }

    // Bankeinzahlung des Tages
    let bankAktion = null;
    const bankEl = document.getElementById("bank-wert");
    if (bankEl) {
      const bank = parseChf(bankEl.value);
      if (Number.isNaN(bank)) { errorEl.textContent = "«Einzahlung Bank» ist keine gültige Zahl."; return; }
      if (bank === null) { if (bankVorhanden) bankAktion = { typ: "loeschen" }; }
      else bankAktion = { typ: "speichern", bank };
    }

    if (!aktionen.length && !bankAktion) { errorEl.textContent = "Es wurde nichts eingegeben."; return; }
    if ((aktionen.some((a) => a.typ === "loeschen") || bankAktion?.typ === "loeschen") &&
        !confirm("Mindestens ein bisher gespeicherter Eintrag ist jetzt leer. Diesen Eintrag für diesen Tag löschen?")) return;

    saveBtn.disabled = true;
    try {
      const wer = session.profile.name || "";
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
            updatedBy: wer,
          });
        }
      }
      if (bankAktion) {
        const ref = doc(db, "tagesbank", datum);
        if (bankAktion.typ === "loeschen") await deleteDoc(ref);
        else await setDoc(ref, { datum, bank: bankAktion.bank, updatedAt: serverTimestamp(), updatedBy: wer });
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
