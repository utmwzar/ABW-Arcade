// Scharfe Spielfelder: Der Canvas bekommt so viele Pixel, wie er auf dem
// Bildschirm wirklich belegt (CSS-Breite × devicePixelRatio); die Spiele
// zeichnen weiter in Spielkoordinaten (width × height). Wie groß das Feld auf
// der Seite ist, bestimmt allein CSS (.game-canvas in games.css).
//
// Wichtig für Touch: Spielkoordinaten kommen aus getBoundingClientRect() und
// den Konstanten der Spiele, nie aus canvas.width – das ist jetzt die Zahl der
// Bildpunkte.

export function crisp(canvas, { width, height, onResize = null, maxScale = 3 }) {
  const ctx = canvas.getContext("2d");

  function fit(notify = true) {
    const cssWidth = canvas.getBoundingClientRect().width || width;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(maxScale, Math.max(1, (cssWidth * dpr) / width));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    if (w === canvas.width && h === canvas.height) return;
    canvas.width = w;      // setzt auch den Kontext zurück
    canvas.height = h;
    ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
    if (notify && onResize) onResize();
  }

  // Beim Einrichten zeichnet das Spiel selbst; onResize käme hier zu früh
  // (der Aufrufer hat ctx noch gar nicht).
  fit(false);
  if (typeof ResizeObserver === "function") new ResizeObserver(() => fit()).observe(canvas);
  // Zoom und Wechsel auf einen anderen Bildschirm ändern nur devicePixelRatio.
  window.addEventListener("resize", () => fit());
  return ctx;
}
