// Einstellungen eines Spielers in seinem Browser: Komfort, nie Spielstände.
//
// Bis auf ein kleines Skript im <head> von base.html ist das die einzige
// Stelle, die localStorage benutzt (Regeln: docs/gestaltung.md). Gespeichert
// wird nur, was in SCHEMA steht. Sitzung, Scores, game_id und Seeds gehören
// auf den Server, der jede Partie selbst nachspielt.
//
// Die Seite muss mit leerem oder gesperrtem Speicher genauso funktionieren
// (privates Fenster, blockierte Website-Daten). Darum steckt jeder Zugriff in
// try/catch, und bei einem Fehler arbeitet das Modul still im Arbeitsspeicher
// weiter.

const PREFIX = "abw.v1.";
const SLUG = /^[a-z0-9-]{1,32}$/;

// Die einzige Liste der gespeicherten Einstellungen. Ein neues Feld braucht
// nur einen Eintrag hier.
export const SCHEMA = {
  "ui.motion":      { default: "system", values: ["system", "full", "reduced", "off"] },
  "ui.touch":       { default: "auto",   values: ["auto", "on", "off"] },
  "chess.coords":   { default: true,     type: "boolean" },
  "chess.hints":    { default: true,     type: "boolean" },
  "chess.botLevel": { default: "medium", values: ["easy", "medium", "hard"] },
  "chess.botColor": { default: "random", values: ["random", "w", "b"] },
  "doom.sound":     { default: false,    type: "boolean" },
  "help.seen":      { default: [],       type: "slugs", max: 16 },  // Spiel-Slugs
};

function spec(key) {
  const s = SCHEMA[key];
  if (!s) throw new Error(`Unbekannte Einstellung: ${key}`);
  return s;
}

function isValid(s, v) {
  if (s.values) return s.values.includes(v);
  if (s.type === "boolean") return typeof v === "boolean";
  if (s.type === "slugs") {
    return Array.isArray(v) && v.length <= s.max &&
      v.every((x) => typeof x === "string" && SLUG.test(x));
  }
  return false;
}

const copy = (v) => (Array.isArray(v) ? v.slice() : v);

// Liefert ein Prefs-Objekt über einem Storage (Tests geben einen eigenen mit).
export function createPrefs(storage) {
  const memory = new Map();
  const listeners = new Map();   // key | "*" -> Set<fn>
  let backend = storage;

  function read(key) {
    if (backend) {
      try { return backend.getItem(PREFIX + key); }
      catch { backend = null; }
    }
    return memory.has(key) ? memory.get(key) : null;
  }

  function write(key, raw) {
    if (backend) {
      try {
        if (raw === null) backend.removeItem(PREFIX + key);
        else backend.setItem(PREFIX + key, raw);
        return;
      } catch { backend = null; }   // z. B. Kontingent voll: im Arbeitsspeicher weiter
    }
    if (raw === null) memory.delete(key); else memory.set(key, raw);
  }

  function notify(key) {
    const value = get(key);
    for (const k of [key, "*"]) {
      for (const fn of listeners.get(k) || []) {
        try { fn(copy(value), key); } catch (e) { console.error(e); }
      }
    }
  }

  function get(key) {
    const s = spec(key);
    const raw = read(key);
    if (raw !== null) {
      try {
        const v = JSON.parse(raw);
        if (isValid(s, v)) return copy(v);
      } catch { /* kaputter Wert: Default */ }
    }
    return copy(s.default);
  }

  function set(key, value) {
    const s = spec(key);
    if (!isValid(s, value)) {
      console.warn(`Ungültiger Wert für ${key}:`, value);
      return false;
    }
    write(key, JSON.stringify(value));
    notify(key);
    return true;
  }

  function reset(key) {
    spec(key);
    write(key, null);
    notify(key);
  }

  function subscribe(key, fn) {
    if (key !== "*") spec(key);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  }

  // Ein anderer Tab hat etwas geändert (key null = alles gelöscht).
  function onStorageEvent(e) {
    if (e.key === null) { Object.keys(SCHEMA).forEach(notify); return; }
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const key = e.key.slice(PREFIX.length);
    if (SCHEMA[key]) notify(key);
  }

  return { get, set, reset, subscribe, onStorageEvent };
}

function browserStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = PREFIX + "__probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

const prefs = createPrefs(browserStorage());
if (typeof window !== "undefined") window.addEventListener("storage", prefs.onStorageEvent);

export const { get, set, reset, subscribe } = prefs;
