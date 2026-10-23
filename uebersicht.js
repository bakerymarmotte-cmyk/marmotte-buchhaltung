import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { chf, esc, isoDate, deDate } from "./geld.js";

// Übersicht für einen Zeitraum, als Tabelle – druckbar
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

  let letzteDaten = null;

  async function lade() {
    if (!vonEl.value || !bisEl.value || vonEl.value > bisEl.value) {
      bodyEl.innerHTML = '<p class="error-text">Bitte einen gültigen Zeitraum wählen (Von vor Bis).</p>';
      return false;
    }
    bodyEl.innerHTML = '<p class="hint-text">Lädt …</p>';
    try {
      const snap = await getDocs(query(
        collection(db, "tagesabschluesse"),
        where("datum", ">=", vonEl.value),
        where("datum", "<=", bisEl.value),
        orderBy("datum")
      ));
      let rows = snap.docs.map((d) => d.data());
      if (filterEl.value) rows = rows.filter((r) => r.kasseId === filterEl.value);
      rows.sort((a, b) => a.datum.localeCompare(b.datum) || a.kasseName.localeCompare(b.kasseName));
      letzteDaten = rows;
      render(rows);
      return true;
    } catch (err) {
      console.error(err);
      bodyEl.innerHTML = '<p class="error-text">Daten konnten nicht geladen werden.</p>';
      return false;
    }
  }

  function render(rows) {
    const kasseName = filterEl.value ? (kassen.find((k) => k.id === filterEl.value)?.name || "") : "Alle Kassen";
    document.getElementById("report-sub").textContent =
      `${deDate(vonEl.value, false)} – ${deDate(bisEl.value, false)} · ${kasseName}`;
    document.getElementById("report-foot").textContent =
      `Erstellt am ${new Date().toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}`;

    if (!rows.length) {
      bodyEl.innerHTML = '<p class="hint-text">Keine Einträge in diesem Zeitraum.</p>';
      return;
    }
    const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
    const mitKasse = !filterEl.value;
    bodyEl.innerHTML = `
      <div class="table-wrap">
      <table class="report-table">
        <thead><tr>
          <th>Datum</th>${mitKasse ? "<th>Kasse</th>" : ""}
          <th class="r">Brutto</th><th class="r">SumUp</th><th class="r">Bank</th>
        </tr></thead>
        <tbody>
          ${rows.map((r) => `<tr>
            <td class="nowrap">${deDate(r.datum)}</td>${mitKasse ? `<td>${esc(r.kasseName)}</td>` : ""}
            <td class="r mono">${chf(r.brutto)}</td><td class="r mono">${chf(r.sumup)}</td><td class="r mono">${chf(r.bank)}</td>
          </tr>`).join("")}
        </tbody>
        <tfoot><tr>
          <td${mitKasse ? ' colspan="2"' : ""}>Total (${rows.length} ${rows.length === 1 ? "Eintrag" : "Einträge"})</td>
          <td class="r mono">${chf(sum("brutto"))}</td><td class="r mono">${chf(sum("sumup"))}</td><td class="r mono">${chf(sum("bank"))}</td>
        </tr></tfoot>
      </table>
      </div>`;
  }

  document.getElementById("anzeigen").addEventListener("click", lade);
  document.getElementById("drucken").addEventListener("click", async () => {
    // Immer frisch laden, damit genau der gewählte Zeitraum gedruckt wird
    if (await lade()) setTimeout(() => window.print(), 100);
  });
  filterEl.addEventListener("change", () => { if (letzteDaten) lade(); });

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
