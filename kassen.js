import { db } from "./firebase-config.js";
import {
  addDoc, collection, doc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./geld.js";
import { toast } from "./ui.js";

// Standorte und Kassen verwalten (nur Admin).
// Kassen und Standorte werden nie gelöscht, nur deaktiviert bzw. umbenannt –
// sonst fehlen sie in alten Auswertungen. Der Standort einer Kasse wird beim Anlegen
// festgelegt und danach nicht mehr geändert (alte Einträge gehören zu diesem Standort).
export function initKassen() {
  let kassen = [];
  let standorte = [];
  let bearbeiteId = null;
  let bearbeiteStandortId = null;

  // Kassen-Formular
  const nameEl = document.getElementById("kasse-name");
  const standortEl = document.getElementById("kasse-standort");
  const standortFeld = document.getElementById("kasse-standort-feld");
  const errorEl = document.getElementById("kasse-error");
  const saveBtn = document.getElementById("kasse-speichern");
  const cancelBtn = document.getElementById("kasse-abbrechen");
  const titleEl = document.getElementById("kasse-form-title");
  const listEl = document.getElementById("kassen-list");

  // Standort-Formular
  const sNameEl = document.getElementById("standort-neu-name");
  const sErrorEl = document.getElementById("standort-error");
  const sSaveBtn = document.getElementById("standort-speichern");
  const sCancelBtn = document.getElementById("standort-abbrechen");
  const sTitleEl = document.getElementById("standort-form-title");
  const sListEl = document.getElementById("standorte-list");

  // ---------- Standorte ----------
  function standortFormLeeren() {
    bearbeiteStandortId = null;
    sNameEl.value = "";
    sErrorEl.textContent = "";
    sTitleEl.textContent = "Standorte";
    sSaveBtn.textContent = "Standort anlegen";
    sCancelBtn.style.display = "none";
  }

  sSaveBtn.addEventListener("click", async () => {
    sErrorEl.textContent = "";
    const name = sNameEl.value.trim();
    if (!name) { sErrorEl.textContent = "Bitte einen Namen eingeben."; return; }
    if (standorte.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.id !== bearbeiteStandortId)) {
      sErrorEl.textContent = "Diesen Standort gibt es bereits."; return;
    }
    sSaveBtn.disabled = true;
    try {
      if (bearbeiteStandortId) {
        await updateDoc(doc(db, "standorte", bearbeiteStandortId), { name, updatedAt: serverTimestamp() });
        toast("Standort umbenannt");
      } else {
        await addDoc(collection(db, "standorte"), { name, active: true, createdAt: serverTimestamp() });
        toast(`Standort «${name}» angelegt`);
      }
      standortFormLeeren();
    } catch (err) {
      console.error(err);
      sErrorEl.textContent = "Speichern fehlgeschlagen.";
    } finally {
      sSaveBtn.disabled = false;
    }
  });
  sCancelBtn.addEventListener("click", standortFormLeeren);

  function anzahlKassen(sid) {
    const n = kassen.filter((k) => k.standortId === sid).length;
    return n === 1 ? "1 Kasse" : `${n} Kassen`;
  }

  function renderStandorte() {
    sListEl.innerHTML = standorte.length
      ? standorte.map((s) => `
        <div class="list-item">
          <div class="li-main"><strong>${esc(s.name)}</strong>
            <span class="li-sub">${anzahlKassen(s.id)}</span></div>
          <div class="li-actions">
            <button class="icon-btn" data-standort-edit="${s.id}" title="Umbenennen"><i data-icon="pencil" data-size="15"></i></button>
          </div>
        </div>`).join("")
      : '<p class="hint-text">Noch kein Standort angelegt.</p>';
    sListEl.querySelectorAll("[data-standort-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const s = standorte.find((x) => x.id === b.dataset.standortEdit);
        bearbeiteStandortId = s.id;
        sNameEl.value = s.name;
        sTitleEl.textContent = "Standort umbenennen";
        sSaveBtn.textContent = "Speichern";
        sCancelBtn.style.display = "inline-flex";
        sNameEl.focus();
      })
    );
  }

  // ---------- Kassen ----------
  function formularLeeren() {
    bearbeiteId = null;
    nameEl.value = "";
    errorEl.textContent = "";
    titleEl.textContent = "Neue Kasse";
    saveBtn.textContent = "Kasse anlegen";
    cancelBtn.style.display = "none";
    standortFeld.style.display = "";
  }

  saveBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const name = nameEl.value.trim();
    if (!name) { errorEl.textContent = "Bitte einen Namen eingeben."; return; }
    if (kassen.some((k) => k.name.toLowerCase() === name.toLowerCase() && k.id !== bearbeiteId)) {
      errorEl.textContent = "Es gibt bereits eine Kasse mit diesem Namen."; return;
    }
    const standortId = standortEl.value;
    if (!bearbeiteId && !standortId) { errorEl.textContent = "Bitte zuerst einen Standort anlegen und wählen."; return; }
    saveBtn.disabled = true;
    try {
      if (bearbeiteId) {
        await updateDoc(doc(db, "kassen", bearbeiteId), { name, updatedAt: serverTimestamp() });
        toast("Kasse umbenannt");
      } else {
        await addDoc(collection(db, "kassen"), {
          name, standortId, active: true, auszahlungen: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        toast("Kasse angelegt");
      }
      formularLeeren();
    } catch (err) {
      console.error(err);
      errorEl.textContent = "Speichern fehlgeschlagen.";
    } finally {
      saveBtn.disabled = false;
    }
  });
  cancelBtn.addEventListener("click", formularLeeren);

  function kasseZeile(k) {
    return `
      <div class="list-item ${k.active === false ? "is-inactive" : ""}">
        <div class="li-main">
          <strong>${esc(k.name)}</strong>
          ${k.active === false ? '<span class="li-sub">inaktiv</span>' : ""}
        </div>
        <div class="li-actions">
          <button class="btn btn-secondary btn-small ${k.auszahlungen === true ? "is-on" : ""}" data-ausz="${k.id}" title="Auszahlungen bei dieser Kasse erfassen"><i data-icon="hand-coins" data-size="14"></i> ${k.auszahlungen === true ? "Ausz. an" : "Ausz. aus"}</button>
          <button class="icon-btn" data-edit="${k.id}" title="Umbenennen"><i data-icon="pencil" data-size="15"></i></button>
          <button class="btn btn-secondary btn-small" data-toggle="${k.id}">${k.active === false ? "Aktivieren" : "Deaktivieren"}</button>
        </div>
      </div>`;
  }

  function render() {
    // Standort-Auswahl im Formular
    const aktuell = standortEl.value;
    standortEl.innerHTML = standorte.length
      ? standorte.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("")
      : '<option value="">– zuerst Standort anlegen –</option>';
    if (standorte.some((s) => s.id === aktuell)) standortEl.value = aktuell;

    renderStandorte();

    if (!kassen.length) { listEl.innerHTML = '<p class="hint-text">Noch keine Kassen angelegt.</p>'; return; }
    const sortiert = [...kassen].sort((a, b) => a.name.localeCompare(b.name));
    const gruppen = standorte.map((s) => ({ name: s.name, kassen: sortiert.filter((k) => k.standortId === s.id) }));
    const ohne = sortiert.filter((k) => !standorte.some((s) => s.id === k.standortId));
    if (ohne.length) gruppen.push({ name: "Ohne Standort", kassen: ohne });

    listEl.innerHTML = gruppen
      .filter((g) => g.kassen.length)
      .map((g) => `<h4 class="gruppen-titel">${esc(g.name)}</h4>${g.kassen.map(kasseZeile).join("")}`)
      .join("");

    listEl.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = kassen.find((x) => x.id === b.dataset.edit);
        bearbeiteId = k.id;
        nameEl.value = k.name;
        titleEl.textContent = "Kasse umbenennen";
        saveBtn.textContent = "Speichern";
        cancelBtn.style.display = "inline-flex";
        standortFeld.style.display = "none"; // Standort bleibt
        errorEl.textContent = "";
        nameEl.scrollIntoView({ behavior: "smooth", block: "center" });
      })
    );
    listEl.querySelectorAll("[data-ausz]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = kassen.find((x) => x.id === b.dataset.ausz);
        try {
          await updateDoc(doc(db, "kassen", k.id), { auszahlungen: k.auszahlungen !== true, updatedAt: serverTimestamp() });
          toast(k.auszahlungen !== true ? `Auszahlungen bei «${k.name}» aktiviert` : `Auszahlungen bei «${k.name}» ausgeschaltet`);
        } catch (err) {
          console.error(err);
          toast("Ändern fehlgeschlagen");
        }
      })
    );
    listEl.querySelectorAll("[data-toggle]").forEach((b) =>
      b.addEventListener("click", async () => {
        const k = kassen.find((x) => x.id === b.dataset.toggle);
        const neu = k.active === false;
        if (!neu && !confirm(`Kasse «${k.name}» deaktivieren? Sie erscheint dann nicht mehr beim Erfassen. Bisherige Einträge bleiben erhalten.`)) return;
        try {
          await updateDoc(doc(db, "kassen", k.id), { active: neu, updatedAt: serverTimestamp() });
        } catch (err) {
          console.error(err);
          toast("Ändern fehlgeschlagen");
        }
      })
    );
  }

  return {
    setKassen(list) { kassen = list; render(); },
    setStandorte(list) { standorte = list; render(); },
  };
}
