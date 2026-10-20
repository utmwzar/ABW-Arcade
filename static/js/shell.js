// Seitenrahmen für angemeldete Spieler: Menü auf schmalen Bildschirmen,
// Einstellungsdialog und Kurzmeldungen. Läuft auf jeder Seite.

import { get, set, subscribe } from "./prefs.js";
import { enter, exit } from "./fx.js";

// ---------- Menü (schmale Bildschirme) ----------
const topbar = document.querySelector("[data-topbar]");
const menuBtn = document.querySelector("[data-menu-btn]");
if (topbar && menuBtn) {
  const setOpen = (open) => {
    topbar.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", String(open));
  };
  menuBtn.addEventListener("click", () => setOpen(!topbar.classList.contains("is-open")));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  document.addEventListener("click", (e) => { if (!topbar.contains(e.target)) setOpen(false); });
}

// ---------- Bewegung: die Einstellung wirkt sofort auf CSS ----------
function applyMotion(value) {
  if (value === "system") delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = value;
}
applyMotion(get("ui.motion"));
subscribe("ui.motion", applyMotion);

// ---------- Einstellungsdialog ----------
const dialog = document.getElementById("settings");
if (dialog) {
  const fields = dialog.querySelectorAll("input[name]");
  const sync = () => {
    for (const input of fields) {
      const value = get(input.name);
      if (input.type === "checkbox") input.checked = value === true;
      else input.checked = input.value === value;
    }
  };
  for (const input of fields) {
    input.addEventListener("change", () => {
      set(input.name, input.type === "checkbox" ? input.checked : input.value);
    });
  }
  subscribe("*", sync);
  for (const opener of document.querySelectorAll("[data-settings-open]")) {
    opener.addEventListener("click", () => {
      sync();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    });
  }
}

// ---------- Rückfrage vor endgültigen Aktionen ----------
const confirmDialog = document.getElementById("confirm");

// ask("Frage", "Löschen") -> Promise<boolean>
export function ask(question, action = "Bestätigen") {
  if (!confirmDialog || typeof confirmDialog.showModal !== "function") {
    return Promise.resolve(window.confirm(question));
  }
  confirmDialog.querySelector("[data-confirm-text]").textContent = question;
  confirmDialog.querySelector("[data-confirm-ok]").textContent = action;
  confirmDialog.returnValue = "";
  return new Promise((resolve) => {
    confirmDialog.addEventListener("close", () => resolve(confirmDialog.returnValue === "ok"), { once: true });
    confirmDialog.showModal();
  });
}

// <form data-confirm="Frage" data-confirm-action="Löschen"> fragt erst nach.
document.addEventListener("submit", async (e) => {
  const form = e.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.confirm) return;
  e.preventDefault();
  if (await ask(form.dataset.confirm, form.dataset.confirmAction)) form.submit();
});

// ---------- Kurzmeldungen ----------
const region = document.querySelector("[data-toasts]");

// toast("Text", { action: "Zum Brett", href: "/...", ms: 6000 })
export function toast(message, { action, href, onAction, ms = 5000 } = {}) {
  if (!region) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.hidden = true;
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);
  if (action) {
    const btn = document.createElement(href ? "a" : "button");
    btn.className = "btn btn-sm";
    btn.textContent = action;
    if (href) btn.href = href; else btn.type = "button";
    if (onAction) btn.addEventListener("click", onAction);
    el.appendChild(btn);
  }
  region.appendChild(el);
  enter(el, { from: "up" });
  setTimeout(() => exit(el).then(() => el.remove()), ms);
}
