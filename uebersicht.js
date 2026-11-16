import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, doc, setDoc, deleteDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { chf, esc, isoDate, deDate } from "./geld.js";
import { toast } from "./ui.js";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const monatName = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MONATE[m - 1]} ${y}`; };
const ymVon = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// Übersicht für einen Zeitraum, als Tabelle – druckbar.
// Pro Tag: eine Zeile je Kasse mit Bar-Tagesumsatz (Brutto − SumUp − Auszahlungen),
// danach eine Tageszeile: Bar aller Kassen gegen die Bankeinzahlung, mit Differenz.
// Dazu: Monatsabschluss (Monat sperren / wieder öffnen).
export function initUebersicht(session, { isAdmin }) {
  let kassen = [];
  let abschluesse = {};   // "YYYY-MM" → Monatsabschluss (live aus app.js)
  let letzteDaten = null; // zuletzt angezeigte Daten, um bei Abschluss-Änderungen neu zu zeichnen
  let standortId = null;
  let standortName = "";
  const vonEl = document.getElementById("von");
  const bisEl = document.getElementById("bis");
  const filterEl = document.getElementById("filter-kasse");
  const bodyEl = document.getElementById("report-body");
  const monatEl = document.getElementById("abschluss-monat");
  const abStatusEl = document.getElementById("abschluss-status");
  const abBtn = document.getElementById("abschluss-btn");

  // Standort-Konten: nur ansehen – kein Drucken, kein Monatsabschluss
  if (!isAdmin) {
    document.getElementById("drucken").style.display = "none";
    document.querySelector(".abschluss-card").style.display = "none";
  }

  // ---------- Monatsauswahl für den Abschluss: die letzten 13 Monate ----------
  (function monateFuellen() {
    const h = new Date();
    const opts = [];
    for (let i = 0; i < 13; i++) {
      const ym = ymVon(new Date(h.getFullYear(), h.getMonth() - i, 1));
      opts.push(`<option value="${ym}">${monatName(ym)}</option>`);
    }
    monatEl.innerHTML = opts.join("");
    monatEl.value = ymVon(new Date(h.getFullYear(), h.getMonth() - 1, 1)); // Standard: letzter Monat
  })();

  function setzeBereich(art) {
    const h = new Date();
    let von, bis;
    if (art === "monat") { von = new Date(h.getFullYear(), h.getMonth(), 1); bis = h; }
    if (art === "vormonat") { von = new Date(h.getFullYear(), h.getMonth() - 1, 1); bis = new Date(h.getFullYear(), h.getMonth(), 0); }
    if (art === "jahr") { von = new Date(h.getFullYear(), 0, 1); bis = h; }
    vonEl.value = isoDate(von);
    bisEl.value = isoDate(bis);
    if (art !== "jahr" && [...monatEl.options].some((o) => o.value === ymVon(von))) {
      monatEl.value = ymVon(von);
      abschlussAnzeigen();
    }
  }
  setzeBereich("monat");
  document.querySelectorAll("[data-range]").forEach((b) =>
    b.addEventListener("click", () => { setzeBereich(b.dataset.range); lade(); })
  );

  let geladen = false;

  async function lade() {
    if (!vonEl.value || !bisEl.value || vonEl.value > bisEl.value) {
      bodyEl.innerHTML = '<p class="error-text">Bitte einen gültigen Zeitraum wählen (Von vor Bis).</p>';
      return false;
    }
    if (!standortId) {
      bodyEl.innerHTML = '<p class="hint-text">Es ist noch kein Standort angelegt.</p>';
      return false;
    }
    bodyEl.innerHTML = '<p class="hint-text">Lädt …</p>';
    const bereich = (name) => query(
      collection(db, name),
      where("standortId", "==", standortId),
      where("datum", ">=", vonEl.value),
      where("datum", "<=", bisEl.value),
      orderBy("datum")
    );
    try {
      const [snap, bankSnap] = await Promise.all([getDocs(bereich("tagesabschluesse")), getDocs(bereich("tagesbank"))]);
      let rows = snap.docs.map((d) => d.data());
      if (filterEl.value) rows = rows.filter((r) => r.kasseId === filterEl.value);
      const bank = {};
      bankSnap.docs.forEach((d) => { bank[d.data().datum] = d.data().bank || 0; });
      geladen = true;
      letzteDaten = { rows, bank: filterEl.value ? {} : bank, von: vonEl.value, bis: bisEl.value };
      render(letzteDaten);
      return true;
    } catch (err) {
      console.error(err);
      bodyEl.innerHTML = '<p class="error-text">Daten konnten nicht geladen werden.</p>';
      return false;
    }
  }

  // Abschluss-Status aller Monate im Zeitraum, z.B. «Oktober 2026: abgeschlossen am 02.11.2026»
  function abschlussInfoHtml(von, bis) {
    const monate = [];
    const [vy, vm] = von.split("-").map(Number);
    const ende = bis.slice(0, 7);
    for (let d = new Date(vy, vm - 1, 1); ymVon(d) <= ende; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      monate.push(ymVon(d));
      if (monate.length > 24) break;
    }
    return `<div class="abschluss-info">${monate.map((ym) => {
      const a = abschluesse[ym];
      return a
        ? `<div class="ai-zu"><i data-icon="lock" data-size="13"></i> ${monatName(ym)}: abgeschlossen am ${esc(a.datumText)}</div>`
        : `<div class="ai-offen">${monatName(ym)}: nicht abgeschlossen</div>`;
    }).join("")}</div>`;
  }

  function render({ rows, bank, von, bis }) {
    const gefiltert = !!filterEl.value;
    const kasseName = gefiltert ? (kassen.find((k) => k.id === filterEl.value)?.name || "") : "Alle Kassen";
    document.getElementById("report-sub").textContent =
      `${standortName} · ${deDate(von, false)} – ${deDate(bis, false)} · ${kasseName}`;
    document.getElementById("report-foot").textContent =
      `Erstellt am ${new Date().toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;

    const info = abschlussInfoHtml(von, bis);
    const tage = [...new Set([...rows.map((r) => r.datum), ...Object.keys(bank)])].sort();
    if (!tage.length) {
      bodyEl.innerHTML = info + '<p class="hint-text">Keine Einträge in diesem Zeitraum.</p>';
      return;
    }

    const mitKasse = !gefiltert;
    const mitBank = !gefiltert;          // Bank und Differenz nur bei «Alle Kassen» (Bank gilt für den ganzen Tag)
    const leer = '<td class="r"></td>';
    const vorne = mitKasse ? 2 : 1;      // Spalten vor den Beträgen
    const bar = (r) => (r.brutto || 0) - (r.sumup || 0) - (r.auszahlungenTotal || 0);
    const diffZelle = (d) => `<td class="r mono ${d < 0 ? "neg" : d > 0 ? "pos" : ""}">${d > 0 ? "+" : ""}${chf(d)}</td>`;
    const hinten = mitBank ? leer + leer : "";

    let html = "";
    for (const tag of tage) {
      const tagRows = rows.filter((r) => r.datum === tag).sort((a, b) => a.kasseName.localeCompare(b.kasseName));
      let ersteZeile = true;
      const datumZelle = () => {
        const z = `<td class="nowrap">${ersteZeile ? deDate(tag) : ""}</td>`;
        ersteZeile = false;
        return z;
      };
      for (const r of tagRows) {
        html += `<tr class="${ersteZeile ? "day-start" : ""}">
          ${datumZelle()}${mitKasse ? `<td>${esc(r.kasseName)}</td>` : ""}
          <td class="r mono">${chf(r.brutto)}</td>
          <td class="r mono">${chf(r.sumup)}</td>
          <td class="r mono">${r.auszahlungenTotal ? chf(r.auszahlungenTotal) : ""}</td>
          <td class="r mono strong">${chf(bar(r))}</td>
          ${hinten}
        </tr>`;
        for (const a of r.auszahlungen || []) {
          html += `<tr class="ausz-detail">
            <td></td><td colspan="${vorne - 1 + 2}" class="ausz-detail-text">↳ ${esc(a.text)}</td>
            <td class="r mono">${chf(a.betrag)}</td>${leer}${hinten}
          </tr>`;
        }
      }
      // Tageszeile: Bar aller Kassen gegen die Bankeinzahlung des Tages
      if (mitBank) {
        const barTag = tagRows.reduce((s, r) => s + bar(r), 0);
        const sumupTag = tagRows.reduce((s, r) => s + (r.sumup || 0), 0);
        const bankTag = bank[tag] || 0;
        html += `<tr class="bank-row ${ersteZeile ? "day-start" : ""}">
          ${datumZelle()}<td colspan="${vorne - 1 + 1}">Tagestotal</td>
          <td class="r mono">${chf(sumupTag)}</td>
          ${leer}
          <td class="r mono">${chf(barTag)}</td>
          <td class="r mono">${bank[tag] != null ? chf(bankTag) : "–"}</td>
          ${diffZelle(bankTag - barTag)}
        </tr>`;
      }
    }

    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const barSum = rows.reduce((s, r) => s + bar(r), 0);
    const bankSum = Object.values(bank).reduce((s, v) => s + v, 0);
    bodyEl.innerHTML = `
      ${info}
      <div class="table-wrap">
      <table class="report-table">
        <thead><tr>
          <th>Datum</th>${mitKasse ? "<th>Kasse</th>" : ""}
          <th class="r">Brutto</th><th class="r">SumUp</th><th class="r">Auszahl.</th><th class="r">Bar</th>
          ${mitBank ? '<th class="r">Bank</th><th class="r">Differenz</th>' : ""}
        </tr></thead>
        <tbody>${html}</tbody>
        <tfoot><tr>
          <td${mitKasse ? ' colspan="2"' : ""}>Total (${tage.length} ${tage.length === 1 ? "Tag" : "Tage"})</td>
          <td class="r mono">${chf(sum("brutto"))}</td><td class="r mono">${chf(sum("sumup"))}</td>
          <td class="r mono">${chf(sum("auszahlungenTotal"))}</td><td class="r mono">${chf(barSum)}</td>
          ${mitBank ? `<td class="r mono">${chf(bankSum)}</td>${diffZelle(bankSum - barSum)}` : ""}
        </tr></tfoot>
      </table>
      </div>
      ${mitBank ? `
      <div class="abgleich">
        <div><span>Bar-Tagesumsätze total</span><strong class="mono">${chf(barSum)}</strong></div>
        <div><span>Einzahlungen Bank total</span><strong class="mono">${chf(bankSum)}</strong></div>
        <div class="abgleich-diff ${bankSum - barSum < 0 ? "neg" : bankSum - barSum > 0 ? "pos" : ""}"><span>Differenz (Bank − Bar)</span><strong class="mono">${bankSum - barSum > 0 ? "+" : ""}${chf(bankSum - barSum)}</strong></div>
      </div>` : ""}`;
  }

  document.getElementById("anzeigen").addEventListener("click", lade);
  document.getElementById("drucken").addEventListener("click", async () => {
    // Immer frisch laden, damit genau der gewählte Zeitraum gedruckt wird
    if (await lade()) setTimeout(() => window.print(), 100);
  });
  filterEl.addEventListener("change", () => { if (geladen) lade(); });

  // ---------- Monatsabschluss ----------
  function abschlussAnzeigen() {
    if (!isAdmin) return;
    const ym = monatEl.value;
    const a = abschluesse[ym];
    if (a) {
      abStatusEl.innerHTML = `<span class="ab-zu"><i data-icon="lock" data-size="14"></i> Abgeschlossen am ${esc(a.datumText)}${a.abgeschlossenVon ? ` von ${esc(a.abgeschlossenVon)}` : ""}</span>`;
      abBtn.innerHTML = '<i data-icon="refresh-cw" data-size="16"></i> Monat wieder öffnen';
      abBtn.className = "btn btn-secondary";
    } else {
      abStatusEl.innerHTML = '<span class="ab-offen">Offen – Einträge können noch geändert werden.</span>';
      abBtn.innerHTML = '<i data-icon="lock" data-size="16"></i> Monat abschliessen';
      abBtn.className = "btn btn-primary";
    }
  }
  monatEl.addEventListener("change", abschlussAnzeigen);

  abBtn.addEventListener("click", async () => {
    const ym = monatEl.value;
    if (!standortId) return;
    const name = `${monatName(ym)} (${standortName})`;
    const ref = doc(db, "monatsabschluesse", `${standortId}_${ym}`);
    abBtn.disabled = true;
    try {
      if (abschluesse[ym]) {
        if (!confirm(`${name} wieder öffnen?\n\nDanach können die Einträge dieses Monats wieder geändert werden.`)) return;
        await deleteDoc(ref);
        toast(`${name} ist wieder offen`);
      } else {
        // Zur Kontrolle: an wie vielen Tagen etwas erfasst ist
        const [y, m] = ym.split("-").map(Number);
        const von = `${ym}-01`;
        const bis = isoDate(new Date(y, m, 0));
        const bereich = (coll) => query(collection(db, coll), where("standortId", "==", standortId), where("datum", ">=", von), where("datum", "<=", bis), orderBy("datum"));
        const [snap, bankSnap] = await Promise.all([getDocs(bereich("tagesabschluesse")), getDocs(bereich("tagesbank"))]);
        const tageKasse = new Set(snap.docs.map((d) => d.data().datum)).size;
        const tageBank = bankSnap.docs.length;
        const tageMonat = new Date(y, m, 0).getDate();
        const tg = (n) => `${n} ${n === 1 ? "Tag" : "Tagen"}`;
        if (!confirm(
          `${name} abschliessen?\n\n` +
          `Erfasst: Kassen an ${tageKasse} von ${tg(tageMonat)}, Bankeinzahlung an ${tg(tageBank)}.\n\n` +
          `Danach können die Einträge dieses Monats nicht mehr geändert werden. Wieder öffnen ist jederzeit möglich.`
        )) return;
        await setDoc(ref, { monat: ym, standortId, abgeschlossenAm: serverTimestamp(), abgeschlossenVon: session.profile.name || "" });
        toast(`${name} abgeschlossen`);
      }
    } catch (err) {
      console.error(err);
      toast("Das hat nicht geklappt. Bitte Verbindung prüfen.");
    } finally {
      abBtn.disabled = false;
    }
  });

  return {
    setStandort(sid, name) {
      standortName = name || "";
      if (sid === standortId) return;
      standortId = sid;
      letzteDaten = null;
      geladen = false;
      filterEl.value = "";
      bodyEl.innerHTML = '<p class="hint-text">Zeitraum wählen und «Anzeigen» tippen.</p>';
    },
    setKassen(list) {
      kassen = list;
      const aktuell = filterEl.value;
      filterEl.innerHTML = '<option value="">Alle Kassen</option>' +
        list.map((k) => `<option value="${k.id}">${esc(k.name)}${k.active === false ? " (inaktiv)" : ""}</option>`).join("");
      filterEl.value = list.some((k) => k.id === aktuell) ? aktuell : "";
    },
    setAbschluesse(map) {
      abschluesse = map;
      abschlussAnzeigen();
      if (letzteDaten) render(letzteDaten);
    },
  };
}
