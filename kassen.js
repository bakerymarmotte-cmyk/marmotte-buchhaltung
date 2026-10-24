import { db } from "./firebase-config.js";
import {
  addDoc, collection, doc, updateDoc, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { esc } from "./geld.js";
import { toast } from "./ui.js";

// Kassen verwalten. Kassen werden nie gelöscht, nur deaktiviert –
// sonst fehlen sie in alten Auswertungen.
export function initKassen() {
  let kassen = [];
  let bearbeiteId = null;

  const nameEl = document.getElementById("kasse-name");
  const errorEl = document.getElementById("kasse-error");
  const saveBtn = document.getElementById("kasse-speichern");
  const cancelBtn = document.getElementById("kasse-abbrechen");
  const titleEl = document.getElementById("kasse-form-title");
  const listEl = document.getElementById("kassen-list");

  function formularLeeren() {
    bearbeiteId = null;
    nameEl.value = "";
    errorEl.textContent = "";
    titleEl.textContent = "Neue Kasse";
    saveBtn.textContent = "Kasse anlegen";
    cancelBtn.style.display = "none";
  }

  saveBtn.addEventListener("click", async () => {
    errorEl.textContent = "";
    const name = nameEl.value.trim();
    if (!name) { errorEl.textContent = "Bitte einen Namen eingeben."; return; }
    if (kassen.some((k) => k.name.toLowerCase() === name.toLowerCase() && k.id !== bearbeiteId)) {
      errorEl.textContent = "Es gibt bereits eine Kasse mit diesem Namen."; return;
    }
    saveBtn.disabled = true;
    try {
      if (bearbeiteId) {
        await updateDoc(doc(db, "kassen", bearbeiteId), { name, updatedAt: serverTimestamp() });
        toast("Kasse umbenannt");
      } else {
        await addDoc(collection(db, "kassen"), { name, active: true, auszahlungen: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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

  function render() {
    if (!kassen.length) { listEl.innerHTML = '<p class="hint-text">Noch keine Kassen angelegt.</p>'; return; }
    listEl.innerHTML = kassen
      .map((k) => `
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
        </div>`)
      .join("");
    listEl.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", () => {
        const k = kassen.find((x) => x.id === b.dataset.edit);
        bearbeiteId = k.id;
        nameEl.value = k.name;
        titleEl.textContent = "Kasse umbenennen";
        saveBtn.textContent = "Speichern";
        cancelBtn.style.display = "inline-flex";
        errorEl.textContent = "";
        window.scrollTo({ top: 0, behavior: "smooth" });
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
    setKassen(list) {
      kassen = list;
      render();
    },
  };
}
