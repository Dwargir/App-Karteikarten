// Lädt die Browser-Skripte (core, features, views) in eine Node-VM mit kleinen Attrappen für Browser-Objekte.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(){
  const store = new Map();
  const ctx = {
    window:{SK_CONFIG:{}}, console, setTimeout, clearTimeout, crypto:globalThis.crypto, structuredClone,
    TextDecoder, Blob, URL, Math, Date, JSON,
    localStorage:{getItem:k => store.has(k) ? store.get(k) : null, setItem:(k, v) => store.set(k, String(v)), removeItem:k => store.delete(k)},
    navigator:{}, document:{querySelector:() => null, querySelectorAll:() => [], createElement:() => ({setAttribute(){}}), body:{append(){}}},
    location:{origin:"https://example.org", pathname:"/"}, requestAnimationFrame:f => f(), cancelAnimationFrame(){}, scrollTo(){}
  };
  vm.createContext(ctx);
  for (const f of ["core.js", "features.js", "views.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "js", f), "utf8"), ctx, {filename:f});
  }
  // In main.js definierte Render-Funktionen werden hier nicht gebraucht
  vm.runInContext("var renderMain = () => {}, renderHeader = () => {}, render = () => {}, softRender = () => {}, renderStage = () => {};", ctx);
  // run: Ergebnis als reine JSON-Daten (vergleichbar mit assert.deepEqual), raw: unverändert (z. B. Funktionen)
  const raw = code => vm.runInContext(code, ctx);
  const run = code => { const v = raw(code); return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); };
  return {ctx, run, raw};
}
module.exports = {load};
