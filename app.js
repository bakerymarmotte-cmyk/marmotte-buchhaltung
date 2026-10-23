import { requireSession, logout } from "./session.js";
import { db } from "./firebase-config.js";
import { collection, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initErfassen } from "./erfassen.js";
import { initUebersicht } from "./uebersicht.js";
import { initKassen } from "./kassen.js";
import { toast } from "./ui.js";

async function start() {
  let session;
  try {
    session = await requireSession();
  } catch (e) {
    return; // requireSession hat bereits umgeleitet
  }

  document.getElementById("logout-btn").addEventListener("click", logout);

  // Die Buchhaltung ist nur für Admins
  if (session.profile.role !== "admin") {
    document.querySelector("main").innerHTML =
      '<div class="card form-card" style="margin-top:24px;"><h3 class="section-title">Kein Zugriff</h3>' +
      '<p class="hint-text">Die Buchhaltung ist nur für Admins freigegeben.</p></div>';
    document.querySelector(".nav-wrap").style.display = "none";
    return;
  }

  document.getElementById("user-name-label").textContent = session.profile.name || "";
  setupNav();

  const erfassen = initErfassen(session);
  const uebersicht = initUebersicht(session);
  const kassen = initKassen(session);

  // Kassen live laden und an alle Bereiche weitergeben
  onSnapshot(
    query(collection(db, "kassen"), orderBy("name")),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      erfassen.setKassen(list);
      uebersicht.setKassen(list);
      kassen.setKassen(list);
    },
    (err) => {
      console.error(err);
      toast("Kassen konnten nicht geladen werden.");
    }
  );
}

function setupNav() {
  const buttons = document.querySelectorAll("#main-nav button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById("panel-" + btn.dataset.tab).classList.add("active");
      window.scrollTo(0, 0);
    });
  });
}

start();
