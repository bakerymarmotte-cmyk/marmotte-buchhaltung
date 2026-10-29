import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { chf, esc, isoDate, deDate } from "./geld.js";

// Übersicht für einen Zeitraum, als Tabelle – druckbar.
// Pro Tag: eine Zeile je Kasse mit Bar-Tagesumsatz (Brutto − SumUp − Auszahlungen),
// danach eine Tageszeile: Bar aller Kassen gegen die Bankeinzahlung, mit Differenz.
export function initUebersicht() {
  let kassen = [];
  const vonEl = document.getElementById("von");
  const bisEl = document.getElementById("bis");
  const filterEl = document.getElementById("filter-kasse");
  const bodyEl = document.getElementById("report-body");

  function setzeBereich(art) {
    const h = new Date();
    let von, bis;
    if (art === "monat") { von = new Date(h.getFullYear(), h.getMonth(), 1); bis = h; }
    if (art === "vormonat") { von = new Date(h.getFullYear(), h.getMonth() - 1, 1); bis = new Date(h.getFullYear(), h.getMonth(), 0); }
    if (art === "jahr") { von = new Date(h.getFullYear(), 0, 1); bis = h; }
    vonEl.value = isoDate(von);
    bisEl.value = isoDate(bis);
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
    bodyEl.innerHTML = '<p class="hint-text">Lädt …</p>';
    const bereich = (name) => query(
      collection(db, name),
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
      render(rows, filterEl.value ? {} : bank);
      return true;
    } catch (err) {
      console.error(err);
      bodyEl.innerHTML = '<p class="error-text">Daten konnten nicht geladen werden.</p>';
      return false;
    }
  }

  function render(rows, bank) {
    const gefiltert = !!filterEl.value;
    const kasseName = gefiltert ? (kassen.find((k) => k.id === filterEl.value)?.name || "") : "Alle Kassen";
    document.getElementById("report-sub").textContent =
      `${deDate(vonEl.value, false)} – ${deDate(bisEl.value, false)} · ${kasseName}`;
    document.getElementById("report-foot").textContent =
      `Erstellt am ${new Date().toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;

    const tage = [...new Set([...rows.map((r) => r.datum), ...Object.keys(bank)])].sort();
    if (!tage.length) {
      bodyEl.innerHTML = '<p class="hint-text">Keine Einträge in diesem Zeitraum.</p>';
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
        const bankTag = bank[tag] || 0;
        html += `<tr class="bank-row ${ersteZeile ? "day-start" : ""}">
          ${datumZelle()}<td colspan="${vorne - 1 + 3}">Tagestotal · Einzahlung Bank</td>
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

  return {
    setKassen(list) {
      kassen = list;
      const aktuell = filterEl.value;
      filterEl.innerHTML = '<option value="">Alle Kassen</option>' +
        list.map((k) => `<option value="${k.id}">${esc(k.name)}${k.active === false ? " (inaktiv)" : ""}</option>`).join("");
      filterEl.value = list.some((k) => k.id === aktuell) ? aktuell : "";
    },
  };
}
