// Spieleübersicht: Die Zahlentasten starten das Spiel mit dieser Nummer,
// Enter startet die hervorgehobene Kapsel („Weiterspielen“).

const byKey = new Map([...document.querySelectorAll("a[data-key]")].map((a) => [a.dataset.key, a]));
const featured = document.querySelector("a[data-featured]");

function busy(target) {
  return document.querySelector("dialog[open]") ||
    (target instanceof Element && target.closest("input, textarea, select, [contenteditable]"));
}

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || busy(e.target)) return;
  let link = byKey.get(e.key);
  // Enter auf einem Link oder Button behält seine eigene Bedeutung.
  if (!link && e.key === "Enter" && (e.target === document.body || e.target === document.documentElement)) {
    link = featured;
  }
  if (!link) return;
  e.preventDefault();
  link.classList.add("is-pressed");
  window.location.assign(link.href);
});

// Kommt man mit „Zurück“ auf die Seite, soll keine Kapsel gedrückt bleiben.
window.addEventListener("pageshow", () => {
  for (const a of byKey.values()) a.classList.remove("is-pressed");
});
