// Kleine Ersatzfunktionen für ältere Browser (z. B. iPhone/iPad mit iOS 15, ältere Android-Tablets).
// Wird als erstes Modul geladen; neuere Browser nutzen ihre eingebauten Versionen.

if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value(n) {
      let i = Math.trunc(n) || 0;
      if (i < 0) i += this.length;
      return this[i];
    },
    writable: true,
    configurable: true,
  });
}

if (typeof HTMLFormElement !== 'undefined' && !HTMLFormElement.prototype.requestSubmit) {
  HTMLFormElement.prototype.requestSubmit = function requestSubmit() {
    const b = document.createElement('button');
    b.type = 'submit';
    b.hidden = true;
    this.appendChild(b);
    b.click();
    b.remove();
  };
}
