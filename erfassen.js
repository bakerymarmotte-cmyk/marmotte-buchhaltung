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
// Jede Kasse und die Bank haben einen eigenen Speichern-Knopf. So überschreibt
// niemand die Eingaben einer anderen Kasse, wenn zwei Personen gleichzeitig erfassen.
const docId = (kasseId, datum) => `${kasseId}_${datum}`;

export function initErfassen(session) {
  let kassen = [];
  let vorhanden = {};       // kasseId → gespeicherter Eintrag für den gewählten Tag
  let bankVorhanden = null; // gespeicherte Bankeinzahlung des Tages
  let abschluesse = {};     // "YYYY-MM" → Monatsabschluss (live aus app.js)
  let aktuellerTag = "";    // Tag, der gerade angezeigt wird
  let laedt = false;
  let ersterLadevorgang = true;

  const tagEl = document.getElementById("tag");
  const listEl = document.getElementById("erfassen-list");
  const errorEl = document.getElementById("erfassen-error");
  const lockEl = document.getElementById("erfassen-gesperrt");
  const hinweisEl = document.getElementById("erfassen-hinweis");

  tagEl.value = isoDate();
  tagEl.max = isoDate();

  const gesperrt = () => abschluesse[aktuellerTag.slice(0, 7)] || null;

  // Nicht gespeicherte Eingaben vor dem Tageswechsel melden
  function darfWechseln() {
    if (!listEl.querySelector(".kasse-card.dirty")) return true;
    return confirm("Es gibt Eingaben, die noch nicht gespeichert sind. Trotzdem den Tag wechseln? Die Eingaben gehen dann verloren.");
  }

  function verschiebeTag(delta) {
    const [y, m, d] = tagEl.value.split("-").map(Number);
    const neu = new Date(y, m - 1, d + delta);
    if (isoDate(neu) > isoDate()) return; // nicht in die Zukunft
    if (!darfWechseln()) return;
    tagEl.value = isoDate(neu);
    ladeTag();
  }
  document.getElementById("tag-zurueck").addEventListener("click", () => verschiebeTag(-1));
  document.getElementById("tag-vor").addEventListener("click", () => verschiebeTag(1));
  tagEl.addEventListener("change", () => {
    if (!tagEl.value) return;
    if (!darfWechseln()) { tagEl.value = aktuellerTag; return; }
    ladeTag();
  });

  async function ladeTag() {
    if (!tagEl.value) return;
    aktuellerTag = tagEl.value;
    document.getElementById("tag-label").textContent = deDate(aktuellerTag);
    laedt = true;
    errorEl.textContent = "";
    try {
      const [snap, bankSnap] = await Promise.all([
        getDocs(query(collection(db, "tagesabschluesse"), where("datum", "==", aktuellerTag))),
        getDoc(doc(db, "tagesbank", aktuellerTag)),
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

  // ---------- Bausteine ----------
  function auszahlungZeile(a = {}, zu = false) {
    return `
      <div class="ausz-row">
        <input type="text" class="ausz-text" maxlength="80" placeholder="Wofür? z.B. Einkauf Migros" value="${esc(a.text || "")}"${zu ? " disabled" : ""}>
        <span class="betrag-input ausz-betrag"><span class="cur">CHF</span>
          <input type="text" inputmode="decimal" class="ausz-wert" value="${toInput(a.betrag)}" placeholder="0.00"${zu ? " disabled" : ""}>
        </span>
        ${zu ? "" : '<button type="button" class="icon-btn ausz-weg" title="Auszahlung entfernen" aria-label="Auszahlung entfernen"><i data-icon="x" data-size="15"></i></button>'}
      </div>`;
  }

  function statusBadge(gespeichert) {
    return `<span class="kc-status">${gespeichert ? '<span class="saved-badge"><i data-icon="circle-check" data-size="14"></i> gespeichert</span>' : ""}</span>`;
  }

  function fussHtml(zu) {
    if (zu) return "";
    return `
      <div class="kc-foot">
        <div class="error-text kc-error"></div>
        <button type="button" class="btn btn-primary btn-small kc-save"><i data-icon="save" data-size="14"></i> Speichern</button>
      </div>`;
  }

  function kasseHtml(k) {
    const v = vorhanden[k.id];
    const zu = !!gesperrt();
    const mitAusz = k.auszahlungen === true || (v?.auszahlungen?.length > 0);
    return `
      <div class="card kasse-card" data-kasse="${k.id}">
        <div class="kc-head">
          <strong>${esc(k.name)}</strong>
          ${statusBadge(!!v)}
        </div>
        ${FELDER.map((f) => `
          <label class="betrag-row">
            <span>${f.label}</span>
            <span class="betrag-input"><span class="cur">CHF</span>
              <input type="text" inputmode="decimal" data-feld="${f.key}" value="${toInput(v?.[f.key])}" placeholder="0.00"${zu ? " disabled" : ""}>
            </span>
          </label>`).join("")}
        ${mitAusz ? `
          <div class="ausz-block">
            <div class="ausz-head"><span>Auszahlungen</span><span class="ausz-total mono"></span></div>
            <div class="ausz-list">${(v?.auszahlungen || []).map((a) => auszahlungZeile(a, zu)).join("")}</div>
            ${zu ? "" : '<button type="button" class="btn btn-secondary btn-small ausz-neu"><i data-icon="plus" data-size="14"></i> Auszahlung</button>'}
          </div>` : ""}
        <div class="bar-row"><span>Bar-Tagesumsatz <span class="bar-formel">(Brutto − SumUp${mitAusz ? " − Auszahlungen" : ""})</span></span><strong class="mono bar-wert"></strong></div>
        ${fussHtml(zu)}
      </div>`;
  }

  function bankHtml() {
    const zu = !!gesperrt();
    return `
      <div class="card kasse-card bank-card" data-bank="1">
        <div class="kc-head">
          <strong><i data-icon="banknote" data-size="16"></i> Bank</strong>
          ${statusBadge(!!bankVorhanden)}
        </div>
        <label class="betrag-row">
          <span>Einzahlung Bank (ganzer Tag)</span>
          <span class="betrag-input"><span class="cur">CHF</span>
            <input type="text" inputmode="decimal" class="bank-wert" value="${toInput(bankVorhanden?.bank)}" placeholder="0.00"${zu ? " disabled" : ""}>
          </span>
        </label>
        ${fussHtml(zu)}
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

  function karteVorbereiten(card) {
    auszahlungTotalAnzeigen(card);
    if (card.dataset.kasse) barAnzeigen(card);
  }

  function render() {
    const aktive = kassen.filter((k) => k.active !== false || vorhanden[k.id]);
    document.getElementById("keine-kassen").style.display = aktive.length ? "none" : "block";
    hinweisEl.style.display = aktive.length && !gesperrt() ? "block" : "none";

    const lock = gesperrt();
    if (lock) {
      lockEl.style.display = "flex";
      lockEl.querySelector(".lock-text").textContent =
        `Dieser Monat ist abgeschlossen${lock.datumText ? ` (am ${lock.datumText})` : ""}. Die Einträge können nicht mehr geändert werden. Wieder öffnen kann man ihn unter «Übersicht & Druck».`;
    } else {
      lockEl.style.display = "none";
    }

    listEl.innerHTML = aktive.map(kasseHtml).join("") + (aktive.length ? bankHtml() : "");
    listEl.querySelectorAll(".kasse-card").forEach(karteVorbereiten);
  }

  // Nur eine Karte neu zeichnen (die Eingaben in den anderen Karten bleiben stehen)
  function karteNeu(card, html) {
    card.outerHTML = html;
  }

  function alsGeaendert(card) {
    if (card.classList.contains("dirty")) return;
    card.classList.add("dirty");
    card.querySelector(".kc-status").innerHTML = '<span class="dirty-badge">nicht gespeichert</span>';
  }

  // Ereignisse in der Liste (einmal registriert, gilt auch für neu gezeichnete Karten)
  listEl.addEventListener("focusin", (e) => { if (e.target.matches(".betrag-input input")) e.target.select(); });
  listEl.addEventListener("input", (e) => {
    const card = e.target.closest(".kasse-card");
    if (!card) return;
    alsGeaendert(card);
    if (e.target.matches(".ausz-wert")) auszahlungTotalAnzeigen(card);
    if (e.target.matches("[data-feld], .ausz-wert")) barAnzeigen(card);
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
      alsGeaendert(card);
      auszahlungTotalAnzeigen(card);
      barAnzeigen(card);
      return;
    }
    const save = e.target.closest(".kc-save");
    if (save) {
      const card = save.closest(".kasse-card");
      if (card.dataset.bank) speichereBank(card, save);
      else speichereKasse(card, save);
    }
  });

  // ---------- Speichern: eine Kasse ----------
  async function speichereKasse(card, btn) {
    if (laedt || gesperrt()) return;
    const err = card.querySelector(".kc-error");
    err.textContent = "";
    const datum = aktuellerTag;
    const kasse = kassen.find((k) => k.id === card.dataset.kasse);

    const werte = {};
    let leer = true;
    for (const f of FELDER) {
      const r = parseChf(card.querySelector(`[data-feld="${f.key}"]`).value);
      if (Number.isNaN(r)) { err.textContent = `«${f.label}» ist keine gültige Zahl.`; return; }
      if (r !== null) leer = false;
      werte[f.key] = r ?? 0;
    }

    const auszahlungen = [];
    for (const row of card.querySelectorAll(".ausz-row")) {
      const text = row.querySelector(".ausz-text").value.trim();
      const betrag = parseChf(row.querySelector(".ausz-wert").value);
      if (!text && betrag === null) continue; // leere Zeile ignorieren
      if (Number.isNaN(betrag) || betrag === null || betrag <= 0) {
        err.textContent = `Auszahlung «${text || "ohne Text"}» braucht einen gültigen Betrag.`; return;
      }
      if (!text) { err.textContent = "Bitte bei jeder Auszahlung angeben, wofür."; return; }
      auszahlungen.push({ text, betrag });
    }
    if (auszahlungen.length) leer = false;
    werte.auszahlungen = auszahlungen;
    werte.auszahlungenTotal = auszahlungen.reduce((s, a) => s + a.betrag, 0);

    if (leer && !vorhanden[kasse.id]) { err.textContent = "Es wurde nichts eingegeben."; return; }
    if (leer && !confirm(`Alle Felder von «${kasse.name}» sind leer. Den gespeicherten Eintrag für diesen Tag löschen?`)) return;

    btn.disabled = true;
    try {
      const ref = doc(db, "tagesabschluesse", docId(kasse.id, datum));
      if (leer) {
        await deleteDoc(ref);
        delete vorhanden[kasse.id];
        toast(`${kasse.name}: Eintrag gelöscht`);
      } else {
        const daten = {
          kasseId: kasse.id,
          kasseName: kasse.name,
          datum,
          ...werte,
          updatedAt: serverTimestamp(),
          updatedBy: session.profile.name || "",
        };
        await setDoc(ref, daten);
        vorhanden[kasse.id] = daten;
        toast(`${kasse.name}: ${deDate(datum, false)} gespeichert`);
      }
      if (datum !== aktuellerTag) return; // inzwischen anderer Tag gewählt
      const alt = listEl.querySelector(`.kasse-card[data-kasse="${kasse.id}"]`);
      if (alt) {
        karteNeu(alt, kasseHtml(kasse));
        karteVorbereiten(listEl.querySelector(`.kasse-card[data-kasse="${kasse.id}"]`));
      }
    } catch (e) {
      console.error(e);
      err.textContent = istGesperrtFehler(e)
        ? "Dieser Monat ist abgeschlossen. Speichern nicht möglich."
        : "Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.";
      btn.disabled = false;
    }
  }

  // ---------- Speichern: Bankeinzahlung des Tages ----------
  async function speichereBank(card, btn) {
    if (laedt || gesperrt()) return;
    const err = card.querySelector(".kc-error");
    err.textContent = "";
    const datum = aktuellerTag;
    const bank = parseChf(card.querySelector(".bank-wert").value);
    if (Number.isNaN(bank)) { err.textContent = "«Einzahlung Bank» ist keine gültige Zahl."; return; }
    if (bank === null && !bankVorhanden) { err.textContent = "Es wurde nichts eingegeben."; return; }
    if (bank === null && !confirm("Das Feld ist leer. Die gespeicherte Bankeinzahlung für diesen Tag löschen?")) return;

    btn.disabled = true;
    try {
      const ref = doc(db, "tagesbank", datum);
      if (bank === null) {
        await deleteDoc(ref);
        bankVorhanden = null;
        toast("Bankeinzahlung gelöscht");
      } else {
        const daten = { datum, bank, updatedAt: serverTimestamp(), updatedBy: session.profile.name || "" };
        await setDoc(ref, daten);
        bankVorhanden = daten;
        toast(`Bank: ${deDate(datum, false)} gespeichert`);
      }
      if (datum !== aktuellerTag) return;
      const alt = listEl.querySelector(".bank-card");
      if (alt) karteNeu(alt, bankHtml());
    } catch (e) {
      console.error(e);
      err.textContent = istGesperrtFehler(e)
        ? "Dieser Monat ist abgeschlossen. Speichern nicht möglich."
        : "Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.";
      btn.disabled = false;
    }
  }

  // Die Regeln lehnen Schreiben in abgeschlossenen Monaten ab
  function istGesperrtFehler(e) {
    return e?.code === "permission-denied" && !!gesperrt();
  }

  return {
    setKassen(list) {
      kassen = list;
      if (ersterLadevorgang) { ersterLadevorgang = false; ladeTag(); }
      else if (!listEl.querySelector(".kasse-card.dirty")) render();
    },
    // Wird bei jeder Änderung der Monatsabschlüsse aufgerufen
    setAbschluesse(map) {
      const vorher = !!gesperrt();
      abschluesse = map;
      if (!ersterLadevorgang && !laedt && vorher !== !!gesperrt()) render();
    },
  };
}
