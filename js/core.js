"use strict";
/* Kern: Helfer, Zustand, Speicher (IndexedDB), Sync (Supabase), Claude-Aufrufe, FSRS-Wiederholung */

/* ---------- Helfer ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = v => Array.isArray(v) ? v : [];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DAY = 864e5;
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const dkey = (d = new Date()) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const rid = p => p+"-"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const code6 = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const daysUntil = ds => Math.round((new Date(ds+"T00:00:00") - today())/DAY);
const fmtDate = t => new Date(t).toLocaleDateString("de-DE",{day:"numeric",month:"short"});
const fmtDays = n => n <= 0 ? "10 Min" : n === 1 ? "1 Tag" : n < 31 ? n+" Tage" : Math.round(n/30)+" Mon.";
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const SUBJ_COLORS = 6;
const MAX_IMAGES = 20;
const CHUNK_CHARS = 80000, MAX_CHUNKS = 6; // lange Skripte: bis zu 6 Teile à 80.000 Zeichen
const REVLOG_MAX = 20000, TOMB_MAX = 500;
const MODELS = [
  {id:"claude-sonnet-5-5", label:"Claude Sonnet 5.5 (empfohlen)"},
  {id:"claude-haiku-5-5", label:"Claude Haiku 5.5 (schnell, günstig)"},
  {id:"claude-opus-5-5", label:"Claude Opus 5.5 (am gründlichsten)"}
];
const CFG = window.SK_CONFIG || {};

const LS = {
  get(k, d = ""){ try { const v = localStorage.getItem("sk."+k); return v === null ? d : v; } catch { return d; } },
  set(k, v){ try { (v === "" || v == null) ? localStorage.removeItem("sk."+k) : localStorage.setItem("sk."+k, v); } catch {} }
};
const settings = {
  get key(){ return LS.get("apiKey"); },      set key(v){ LS.set("apiKey", v); },
  get model(){ return LS.get("model", MODELS[0].id); }, set model(v){ LS.set("model", v); },
  get ytKey(){ return LS.get("ytKey"); },     set ytKey(v){ LS.set("ytKey", v); },
  get sbUrl(){ return LS.get("sbUrl", CFG.supabaseUrl || ""); }, set sbUrl(v){ LS.set("sbUrl", v); },
  get sbKey(){ return LS.get("sbKey", CFG.supabaseAnonKey || ""); }, set sbKey(v){ LS.set("sbKey", v); },
  get useProxy(){ return LS.get("useProxy", CFG.useProxyByDefault ? "1" : "0") === "1"; }, set useProxy(v){ LS.set("useProxy", v ? "1" : "0"); }
};

let toastT;
function toast(msg){
  let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role","status"); document.body.append(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800);
}
function downloadBlob(name, blob){
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function copyText(t){
  try { await navigator.clipboard.writeText(t); toast("Kopiert"); }
  catch { toast("Kopieren nicht möglich, bitte markieren und kopieren."); }
}

/* ---------- Markdown (klein, sicher) ---------- */
function md(src){
  const math = [];
  let s = String(src || "").replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g, m => { math.push(m); return "\u0000" + (math.length-1) + "\u0000"; });
  s = esc(s);
  const inline = t => t
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push("<p>"+inline(para.join(" "))+"</p>"); para = []; } };
  const flushL = () => { if (list) { out.push("</"+list+">"); list = null; } };
  for (const raw of s.split("\n")) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushP(); flushL(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flushP(); flushL(); const l = Math.min(4, m[1].length + 1); out.push(`<h${l}>${inline(m[2])}</h${l}>`); continue; }
    if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { flushP(); if (list !== "ul") { flushL(); out.push("<ul>"); list = "ul"; } out.push("<li>"+inline(m[1])+"</li>"); continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { flushP(); if (list !== "ol") { flushL(); out.push("<ol>"); list = "ol"; } out.push("<li>"+inline(m[1])+"</li>"); continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushP(); flushL(); out.push("<hr>"); continue; }
    flushL(); para.push(line.trim());
  }
  flushP(); flushL();
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, i) => esc(math[i]));
}
function renderMath(el){
  if (!el || !window.renderMathInElement) return;
  try {
    renderMathInElement(el, {delimiters:[{left:"$$", right:"$$", display:true},{left:"$", right:"$", display:false},{left:"\\(", right:"\\)", display:false},{left:"\\[", right:"\\]", display:true}], throwOnError:false, ignoredTags:["script","noscript","style","textarea","pre","code","input","select"]});
  } catch {}
}

/* ---------- Zustand ---------- */
const DEFAULT_PROMPTS = [
  {id:"p-standard", name:"Standard", text:"Fasse das Material strukturiert zusammen: zuerst 2-3 Sätze Überblick, dann Abschnitte mit ## Zwischenüberschriften und Stichpunkten. Hebe Fachbegriffe und Definitionen **fett** hervor. Formeln in LaTeX zwischen $...$."},
  {id:"p-klausur", name:"Klausur-Fokus", text:"Konzentriere dich auf das, was in einer Klausur wahrscheinlich abgefragt wird: Definitionen, Formeln, typische Rechenwege, Abgrenzungen zwischen ähnlichen Begriffen und häufige Fehler. Schließe mit einem Abschnitt „Typische Klausurfragen“ (5 Fragen)."},
  {id:"p-einfach", name:"Einfach erklärt", text:"Erkläre den Stoff so, dass ihn jemand im ersten Semester ohne Vorwissen versteht. Nutze Alltagsbeispiele und Analogien, kurze Sätze und erkläre jeden Fachbegriff beim ersten Auftreten."}
];
const defaultPrefs = () => ({newPerDay:20, retention:0.9, displayName:"", reminder:"18:00"});
const defaultProfile = () => ({type:"profile", subjects:[], log:{}, exams:[], prompts:structuredClone(DEFAULT_PROMPTS), activePromptId:"p-standard", prefs:defaultPrefs(), delSubjects:{}, delPrompts:{}});
const freshUpload = (sid = "") => ({busy:false, stage:"", ctl:null, files:[], text:"", subjectId:sid, newSubject:"", error:"", promptId:""});

const S = {
  ready:false, store:"loading",
  profile:defaultProfile(), docs:{}, revlog:{type:"revlog", items:[]}, examDetails:{}, cardEdit:null, cardQ:"", view:"heute", sel:{subject:null, doc:null, sheet:null},
  review:null, exam:null, duel:null, explain:null, share:null, importShare:null,
  upload:freshUpload(), confirm:null, busy:{}, examTab:"exam", auth:{email:"", busy:false, msg:""}
};

function normProfile(v){
  const p = {...defaultProfile(), ...v};
  p.prefs = {...defaultPrefs(), ...(v && v.prefs)};
  if (!arr(p.prompts).length) p.prompts = structuredClone(DEFAULT_PROMPTS);
  if (!p.prompts.find(x => x.id === p.activePromptId)) p.activePromptId = p.prompts[0].id;
  p.subjects = arr(p.subjects); p.log = p.log || {};
  p.exams = arr(p.exams).map(x => x.id ? x : {...x, id:"x-" + x.date});
  p.delSubjects = p.delSubjects || {}; p.delPrompts = p.delPrompts || {};
  return p;
}
function normDoc(d){
  if (!arr(d.summaries).length && arr(d.summary).length) {
    d.summaries = [{id:rid("m"), promptName:"Kurzfassung", md:d.summary.map(x => "- "+x).join("\n"), createdAt:d.createdAt || Date.now()}];
  }
  d.summaries = arr(d.summaries); d.cards = arr(d.cards); d.delCards = d.delCards || {};
  if (!d.activeSummary && d.summaries[0]) d.activeSummary = d.summaries[0].id;
  for (const c of arr(d.cards)) {
    if (!c.kind) c.kind = "basic";
    if (c.u == null) c.u = c.last || d.createdAt || 0;
    if (c.reps && c.s == null) { const legacy = [0,1,3,7,16,35][c.box || 0] || 1; c.s = Math.max(1, legacy); c.d = 5; c.last = (c.due || Date.now()) - c.s*DAY; }
  }
  return d;
}

/* ---------- Zusammenführen (Sync zwischen Geräten) ---------- */
const byId = (a, b) => { const m = new Map(); for (const x of arr(a)) m.set(x.id, x); for (const x of arr(b)) if (!m.has(x.id)) m.set(x.id, x); return [...m.values()]; };
function mergeTombs(a, b){ const o = {...(a || {})}; for (const [k, v] of Object.entries(b || {})) o[k] = Math.max(o[k] || 0, v); return o; }
function addTomb(obj, id){ obj[id] = Date.now(); const ks = Object.keys(obj); if (ks.length > TOMB_MAX) ks.sort((x, y) => obj[x] - obj[y]).slice(0, ks.length - TOMB_MAX).forEach(k => delete obj[k]); }
const newerFirst = (a, b) => (a._u || 0) >= (b._u || 0) ? [a, b] : [b, a];
/* Karten einzeln zusammenführen: pro Karte gewinnt die zuletzt geänderte (Feld u), Löschungen über delCards. */
function mergeDoc(a, b){
  const [nw, old] = newerFirst(a, b);
  const out = {...old, ...nw, delCards:mergeTombs(a.delCards, b.delCards)};
  const oc = new Map(arr(old.cards).map(c => [c.id, c])), seen = new Set(), cards = [];
  for (const c of arr(nw.cards)) { const o = oc.get(c.id); cards.push(o && (o.u || 0) > (c.u || 0) ? o : c); seen.add(c.id); }
  for (const c of arr(old.cards)) if (!seen.has(c.id)) cards.push(c);
  out.cards = cards.filter(c => !(out.delCards[c.id] >= (c.u || 0)));
  out.summaries = byId(nw.summaries, old.summaries).sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0)).slice(0, 8);
  if (!out.summaries.find(s => s.id === out.activeSummary)) out.activeSummary = out.summaries[0]?.id;
  return out;
}
function mergeProfile(a, b){
  const [nw, old] = newerFirst(a, b);
  const out = {...old, ...nw, prefs:{...old.prefs, ...nw.prefs}};
  out.delSubjects = mergeTombs(a.delSubjects, b.delSubjects);
  out.delPrompts = mergeTombs(a.delPrompts, b.delPrompts);
  out.subjects = byId(nw.subjects, old.subjects).filter(s => !out.delSubjects[s.id]);
  out.prompts = byId(nw.prompts, old.prompts).filter(p => !out.delPrompts[p.id]);
  out.exams = byId(nw.exams, old.exams).sort((x, y) => y.date - x.date).slice(0, 20);
  const log = {...(old.log || {})};
  for (const [k, v] of Object.entries(nw.log || {})) {
    const o = log[k]; if (!o) { log[k] = v; continue; }
    const nb = {...(o.newBy || {})}; for (const [s, n] of Object.entries(v.newBy || {})) nb[s] = Math.max(nb[s] || 0, n);
    log[k] = {n:Math.max(o.n || 0, v.n || 0), ok:Math.max(o.ok || 0, v.ok || 0), newBy:nb};
  }
  out.log = log;
  return normProfile(out);
}
function mergeRevlog(a, b){
  const del = [...new Set([...arr(a?.del), ...arr(b?.del)])].slice(-TOMB_MAX), gone = new Set(del), m = new Map();
  for (const x of [...arr(a?.items), ...arr(b?.items)]) { const k = x[0] + "|" + x[1]; if (!gone.has(k)) m.set(k, x); }
  return {type:"revlog", items:[...m.values()].sort((x, y) => x[1] - y[1]).slice(-REVLOG_MAX), del};
}
function mergeValue(k, a, b){
  if (k === "profile") return mergeProfile(normProfile(a), normProfile(b));
  if (k === "revlog") return mergeRevlog(a, b);
  if (a?.type === "doc" && b?.type === "doc") return normDoc(mergeDoc(normDoc(a), normDoc(b)));
  return newerFirst(a, b)[0];
}

/* ---------- Speicher: IndexedDB ---------- */
let idb = null;
function openDb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open("semesterkartei", 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("img")) db.createObjectStore("img");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(store, mode, fn){
  return new Promise((res, rej) => {
    const t = idb.transaction(store, mode), st = t.objectStore(store);
    const out = fn(st);
    t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
function applyValue(k, v){
  if (k === "profile") S.profile = normProfile(v);
  else if (k === "revlog") S.revlog = {...v, type:"revlog", items:arr(v?.items)};
  else if (v && v.type === "exam") S.examDetails[k] = v;
  else if (v && v.type === "doc") S.docs[k] = normDoc(v);
}
const localVal = k => k === "profile" ? S.profile : k === "revlog" ? S.revlog : k.startsWith("x-") ? S.examDetails[k] : S.docs[k];
function dropLocal(k){
  if (k === "profile") return;
  if (k === "revlog") S.revlog = {type:"revlog", items:[]};
  else if (k.startsWith("x-")) delete S.examDetails[k];
  else { delete S.docs[k]; removeImages(k, true); }
  if (idb) tx("kv","readwrite", st => st.delete(k)).catch(() => {});
}
async function loadAll(){
  const [keys, vals] = await Promise.all([tx("kv","readonly", st => st.getAllKeys()), tx("kv","readonly", st => st.getAll())]);
  keys.forEach((k, i) => applyValue(k, vals[i]));
}
function putLocal(id, data){ if (idb) return tx("kv","readwrite", st => st.put(structuredClone(data), id)).catch(e => toast(e && e.name === "QuotaExceededError" ? "Speicher voll. Lösche alte Dokumente." : "Speichern hat nicht geklappt.")); }
function save(id, data){ data._u = Date.now(); putLocal(id, data); Sync.markDirty(id); }
function remove(id){ if (idb) tx("kv","readwrite", st => st.delete(id)).catch(() => {}); Sync.markDeleted(id); removeImages(id); }
const saveProfile = () => save("profile", S.profile);
const saveRevlog = () => save("revlog", S.revlog);

/* Abbildungen: lokal in IndexedDB, mit Konto zusätzlich im privaten Supabase-Storage-Bucket "img" (Pfad <user>/<doc>/<seite>.jpg) */
const imgUrls = new Map();
const Img = {
  pending:new Set(JSON.parse(LS.get("imgPending","[]"))),
  persist(){ LS.set("imgPending", JSON.stringify([...this.pending])); },
  path(key){ return Sync.uid + "/" + String(key).replace(":", "/") + ".jpg"; },
  async upload(key, blob){
    if (!Sync.uid) { this.pending.add(key); return this.persist(); }
    let error;
    try { ({error} = await Sync.client.storage.from("img").upload(this.path(key), blob, {upsert:true, contentType:"image/jpeg"})); } catch (e) { error = e; }
    if (error) this.pending.add(key); else this.pending.delete(key);
    this.persist();
  },
  async flush(){
    if (!Sync.uid || !idb) return;
    for (const key of [...this.pending]) {
      const b = await tx("img","readonly", st => st.get(key)).catch(() => null);
      if (!b) { this.pending.delete(key); continue; }
      await this.upload(key, b); if (this.pending.has(key)) break;
    }
    this.persist();
  },
  async fetch(key){
    if (!Sync.uid) return null;
    try { const {data, error} = await Sync.client.storage.from("img").download(this.path(key)); if (error || !data) return null; await saveImgLocal(key, data); return data; }
    catch { return null; }
  }
};
function saveImgLocal(key, blob){ if (idb) return tx("img","readwrite", st => st.put(blob, key)).catch(() => {}); }
async function saveImg(key, blob){ await saveImgLocal(key, blob); Img.upload(key, blob); }
async function imgUrl(key){
  if (imgUrls.has(key)) return imgUrls.get(key);
  let b = idb ? await tx("img","readonly", st => st.get(key)).catch(() => null) : null;
  if (!b) b = await Img.fetch(key);
  const u = b ? URL.createObjectURL(b) : null; if (u) imgUrls.set(key, u); return u;
}
async function removeImages(docId, localOnly){
  if (idb) {
    const keys = await tx("img","readonly", st => st.getAllKeys()).catch(() => []);
    const mine = keys.filter(k => String(k).startsWith(docId+":"));
    if (mine.length) tx("img","readwrite", st => { mine.forEach(k => st.delete(k)); }).catch(() => {});
  }
  for (const k of [...Img.pending]) if (k.startsWith(docId + ":")) Img.pending.delete(k);
  Img.persist();
  if (!localOnly && Sync.uid) {
    try {
      const dir = Sync.uid + "/" + docId, {data} = await Sync.client.storage.from("img").list(dir);
      if (data?.length) await Sync.client.storage.from("img").remove(data.map(f => dir + "/" + f.name));
    } catch {}
  }
}
async function hydrateImages(root){
  for (const el of (root || document).querySelectorAll("img[data-img]")) {
    const u = await imgUrl(el.dataset.img);
    if (u) { el.src = u; el.hidden = false; } else el.remove();
  }
}

/* ---------- Sync: Supabase ---------- */
const Sync = {
  client:null, session:null, state:"off", pushing:false, t:null,
  dirty:new Set(JSON.parse(LS.get("dirty","[]"))), tombs:JSON.parse(LS.get("tombs","{}")),
  get configured(){ return !!this.client; },
  get uid(){ return this.session?.user?.id || null; },
  get email(){ return this.session?.user?.email || ""; },
  persist(){ LS.set("dirty", JSON.stringify([...this.dirty])); LS.set("tombs", JSON.stringify(this.tombs)); },
  init(){
    this.client = null; this.session = null;
    if (!settings.sbUrl || !settings.sbKey || !window.supabase) return;
    try { this.client = supabase.createClient(settings.sbUrl, settings.sbKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}}); }
    catch { this.client = null; return; }
    this.client.auth.onAuthStateChange((ev, sess) => {
      const was = this.uid; this.session = sess;
      if (sess && sess.user.id !== was) this.full();
      if (!sess) this.state = "off";
      renderHeader(); if (S.view === "settings" || S.view === "klausur") renderMain();
    });
  },
  async token(){ const {data} = await this.client.auth.getSession(); return data.session?.access_token || null; },
  markDirty(k){ if (!this.client) return; delete this.tombs[k]; this.dirty.add(k); this.persist(); this.schedule(); },
  markDeleted(k){ if (!this.client) return; this.dirty.delete(k); this.tombs[k] = Date.now(); this.persist(); this.schedule(); },
  schedule(ms = 1500){ clearTimeout(this.t); this.t = setTimeout(() => this.push(), ms); },
  valueOf(k){ return localVal(k); },
  async push(){
    if (!this.uid || this.pushing) return;
    if (!this.dirty.size && !Object.keys(this.tombs).length) return;
    this.pushing = true; this.state = "syncing"; renderHeader();
    let sentTs = {}, sentTombs = {};
    try {
      // Erst Änderungen anderer Geräte holen und zusammenführen, damit nichts überschrieben wird
      if (await this.pull(false)) softRender();
      sentTombs = {...this.tombs};
      const rows = [];
      for (const k of this.dirty) { const v = this.valueOf(k); if (!v) { this.dirty.delete(k); continue; } sentTs[k] = v._u || 0; rows.push({user_id:this.uid, key:k, value:v, ts:v._u || Date.now(), deleted:false}); }
      for (const [k, ts] of Object.entries(sentTombs)) rows.push({user_id:this.uid, key:k, value:null, ts, deleted:true});
      for (let i = 0; i < rows.length; i += 40) { const {error} = await this.client.from("kv").upsert(rows.slice(i, i+40)); if (error) throw error; }
      for (const k of Object.keys(sentTs)) if ((this.valueOf(k)?._u || 0) <= sentTs[k]) this.dirty.delete(k);
      for (const k of Object.keys(sentTombs)) if (this.tombs[k] === sentTombs[k]) delete this.tombs[k];
      this.persist(); this.state = "idle";
    } catch (e) { this.state = "error"; this.schedule(30000); }
    finally { this.pushing = false; renderHeader(); if (this.state === "idle" && this.dirty.size) this.schedule(); }
  },
  async pull(full){
    if (!this.uid) return;
    const lkey = "pull:"+this.uid;
    let since = full ? "" : LS.get(lkey, ""), maxSeen = since, seen = new Set(), changed = false;
    for (let page = 0; page < 50; page++) {
      let q = this.client.from("kv").select("key,value,ts,deleted,updated_at").eq("user_id", this.uid).order("updated_at").limit(500);
      if (maxSeen) q = q.gt("updated_at", maxSeen);
      const {data, error} = await q; if (error) throw error;
      for (const r of data) {
        seen.add(r.key); maxSeen = r.updated_at;
        const local = this.valueOf(r.key), lts = local?._u || 0;
        if (r.deleted) {
          if (local && r.ts >= lts) { if (r.key === "profile") continue; dropLocal(r.key); this.dirty.delete(r.key); changed = true; }
        } else if (local && this.dirty.has(r.key) && r.ts !== lts) {
          // Beide Seiten geändert: zusammenführen statt überschreiben
          const m = mergeValue(r.key, local, r.value); m._u = Math.max(lts, r.ts) + 1;
          applyValue(r.key, m); putLocal(r.key, this.valueOf(r.key)); changed = true;
        } else if (!local || r.ts > lts) {
          applyValue(r.key, r.value); putLocal(r.key, r.value); this.dirty.delete(r.key); changed = true;
        } else if (lts > r.ts) this.dirty.add(r.key);
      }
      if (data.length < 500) break;
    }
    if (full) {
      for (const k of ["profile", "revlog", ...Object.keys(S.docs), ...Object.keys(S.examDetails)]) if (!seen.has(k) && (!["profile","revlog"].includes(k) || this.valueOf(k)._u)) this.dirty.add(k);
    }
    if (maxSeen) LS.set(lkey, maxSeen);
    this.persist();
    return changed;
  },
  async full(){
    if (!this.uid || this.fullRunning) return;
    this.fullRunning = true; setTimeout(() => { this.fullRunning = false; }, 3000);
    this.state = "syncing"; renderHeader();
    try { const ch = await this.pull(true); this.state = "idle"; await this.push(); if (ch) softRender(); Img.flush(); }
    catch { this.state = "error"; }
    renderHeader();
  },
  async incremental(){
    if (!this.uid || this.pushing) return;
    try { const ch = await this.pull(false); if (ch) softRender(); await this.push(); } catch { this.state = "error"; renderHeader(); }
  }
};

/* ---------- Claude ---------- */
class AIError extends Error { constructor(code, message){ super(message); this.code = code; } }
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const aiReady = () => (settings.useProxy && Sync.uid) || !!settings.key;
const aiSource = () => (settings.useProxy && Sync.uid) ? "proxy" : settings.key ? "key" : "none";
async function shrinkImage(file, max = 1568){
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width*scale); cv.height = Math.round(bmp.height*scale);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  return await new Promise(r => cv.toBlob(r, "image/jpeg", .85));
}
function parseJSON(text){
  const t = text.trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) {
    const body = t.slice(a, b+1);
    try { return JSON.parse(body); } catch {}
    try { return JSON.parse(body.replace(/\\(?!["\\/bfnrtu])/g, "\\\\")); } catch {}
  }
  throw new AIError("invalid_json", "Antwort war kein gültiges JSON");
}
/* Prompt-Caching: Das Lernmaterial steht als system-Block mit cache_control vorne. Folgeanfragen zum selben Material
   (weitere Karten, Mindmap, Erklär-Chat, neue Zusammenfassung) lesen es dann günstig aus dem Cache. */
const SYSTEM_BASE = "Du hilfst Studierenden an der Uni beim Lernen. Grundlage ist das folgende Lernmaterial.";
const cachedSystem = ctx => ctx ? [{type:"text", text:SYSTEM_BASE + "\n\n<material>\n" + ctx + "\n</material>", cache_control:{type:"ephemeral"}}] : undefined;
async function callClaude({messages, system, maxTokens = 8000, signal, onText}){
  const src = aiSource();
  if (src === "none") throw new AIError("no_key", "Kein Zugang");
  const headers = {"content-type":"application/json"};
  let url;
  if (src === "proxy") {
    url = settings.sbUrl.replace(/\/+$/, "") + "/functions/v1/claude";
    headers.Authorization = "Bearer " + (await Sync.token()); headers.apikey = settings.sbKey;
  } else {
    url = "https://api.anthropic.com/v1/messages";
    headers["x-api-key"] = settings.key; headers["anthropic-version"] = "2023-06-01"; headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  let res;
  try { res = await fetch(url, {method:"POST", signal, headers, body:JSON.stringify({model:settings.model, max_tokens:maxTokens, stream:true, ...(system ? {system} : {}), messages})}); }
  catch (e) { throw new AIError(e.name === "AbortError" ? "cancelled" : "network", e.message); }
  if (!res.ok) {
    let msg = ""; try { const j = await res.json(); msg = j?.error?.message || j?.message || j?.msg || ""; } catch {}
    const base = {400:"bad_request", 401:"auth", 403:"auth", 404:"model", 413:"too_large", 429:"rate_limited", 529:"overloaded"};
    let code = base[res.status] || (res.status >= 500 ? "overloaded" : "bad_request");
    if (src === "proxy" && res.status === 401) code = "proxy_auth";
    if (src === "proxy" && res.status === 403) code = "proxy_forbidden";
    if (src === "proxy" && res.status === 429 && /tageslimit/i.test(msg)) code = "quota";
    if (src === "proxy" && res.status === 404) code = msg.toLowerCase().includes("model") ? "model" : "proxy_missing";
    throw new AIError(code, msg || ("HTTP " + res.status));
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", stop = "";
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream:true});
      const lines = buf.split("\n"); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { text += ev.delta.text; onText?.(text); }
        else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === "error") throw new AIError(ev.error?.type === "overloaded_error" ? "overloaded" : "bad_request", ev.error?.message || "Fehler");
      }
    }
  } catch (e) {
    if (e instanceof AIError) throw e;
    throw new AIError(e.name === "AbortError" ? "cancelled" : "network", e.message);
  }
  if (stop === "refusal") throw new AIError("refused", "Abgelehnt");
  if (stop === "max_tokens") { const err = new AIError("truncated", "Antwort zu lang"); err.text = text; throw err; }
  if (!text.trim()) throw new AIError("empty", "Leere Antwort");
  return text;
}
async function askJSON(prompt, {images = [], pdfs = [], context, signal, maxTokens = 8000, onProgress} = {}){
  const content = [
    ...pdfs.map(data => ({type:"document", source:{type:"base64", media_type:"application/pdf", data}})),
    ...(await Promise.all(images.map(async b => ({type:"image", source:{type:"base64", media_type:"image/jpeg", data: await blobToB64(b)}})))),
    {type:"text", text: prompt + "\n\nAntworte ausschließlich mit dem JSON, ohne Text davor oder danach. Backslashes in LaTeX müssen im JSON verdoppelt werden (\\\\frac)."}
  ];
  const t = await callClaude({messages:[{role:"user", content}], system:cachedSystem(context), maxTokens, signal, onText: x => onProgress?.(x.length)});
  return parseJSON(t);
}
const askText = (prompt, {context, ...opts} = {}) => callClaude({messages:[{role:"user", content:prompt}], system:cachedSystem(context), ...opts});

function errText(e){
  const m = {
    no_key:"Claude ist noch nicht eingerichtet. Hinterlege in den Einstellungen einen API-Schlüssel oder melde dich an und nutze deinen Server.",
    auth:"Der API-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen.",
    proxy_auth:"Deine Anmeldung ist abgelaufen. Melde dich in den Einstellungen neu an.",
    proxy_forbidden:"Dein Konto ist für den Server nicht freigeschaltet. Trag deine E-Mail in ALLOWED_EMAILS ein (siehe Anleitung).",
    quota:"Das Tageslimit für Claude auf deinem Server ist erreicht. Morgen geht es weiter (oder erhöhe DAILY_LIMIT in Supabase).",
    proxy_missing:"Die Server-Funktion „claude“ wurde nicht gefunden. Lege sie in Supabase an (siehe Anleitung).",
    model:"Das gewählte Modell ist nicht verfügbar. Wähle in den Einstellungen ein anderes.",
    rate_limited:"Zu viele Anfragen oder das API-Guthaben ist aufgebraucht. Versuch es in ein paar Minuten noch einmal.",
    overloaded:"Claude ist gerade überlastet. Versuch es gleich noch einmal.",
    too_large:"Das Material ist zu groß. Lade es in kleineren Teilen hoch.",
    network:"Keine Verbindung zu Claude. Prüfe deine Internetverbindung.",
    invalid_json:"Die Antwort kam unvollständig an. Versuch es noch einmal.",
    truncated:"Die Antwort war zu lang und wurde abgeschnitten. Versuch es mit weniger Material.",
    refused:"Claude hat diese Anfrage abgelehnt. Versuch es mit einem anderen Ausschnitt.",
    empty:"Claude hat nichts zurückgegeben. Versuch es noch einmal."
  };
  if (e && e.code === "bad_request") return "Anfrage abgelehnt: " + e.message;
  if (e && m[e.code]) return m[e.code];
  if (e && e.code === "local") return e.message;
  if (e && e.message) return e.message;
  return "Etwas ist schiefgelaufen. Versuch es noch einmal.";
}

/* ---------- FSRS-Wiederholung ---------- */
const FSRS = {
  DEFAULT:[0.4872,1.4003,3.7145,13.8206,5.1618,1.2298,0.8975,0.031,1.6474,0.1367,1.0461,2.1072,0.0793,0.3246,1.587,0.2272,2.8755],
  /* Grenzen je Gewicht für die persönliche Anpassung */
  BOUNDS:[[0.1,100],[0.1,100],[0.1,100],[0.1,100],[1,10],[0.01,4],[0.01,4],[0,0.75],[0,4.5],[0,0.8],[0.01,3.5],[0.1,5],[0.01,0.25],[0.01,0.9],[0.01,4],[0,1],[1,6]],
  DECAY:-0.5, FACTOR:19/81,
  get W(){ const w = S.profile?.prefs?.fsrsW; return Array.isArray(w) && w.length === 17 ? w : this.DEFAULT; },
  r(t, s){ return Math.pow(1 + this.FACTOR*t/s, this.DECAY); },
  ivl(s){ const r = clamp(S.profile.prefs.retention || 0.9, 0.7, 0.97); return clamp(Math.round(s/this.FACTOR*(Math.pow(r, 1/this.DECAY) - 1)), 1, 365); },
  d0(W, g){ return clamp(W[4] - (g-3)*W[5], 1, 10); },
  /* Ein Schritt: prev = {s, d} oder null (erste Wiederholung), g: 1 Nochmal, 2 Schwer, 3 Gut, 4 Leicht, t: Tage seit letzter Wiederholung */
  step(W, prev, g, t){
    if (!prev) return {s:Math.max(0.1, W[g-1]), d:this.d0(W, g)};
    const R = this.r(Math.max(0, t), prev.s);
    const d = clamp(W[7]*this.d0(W, 4) + (1-W[7])*(prev.d - W[6]*(g-3)), 1, 10);
    const s = g === 1
      ? Math.min(prev.s, W[11]*Math.pow(prev.d, -W[12])*(Math.pow(prev.s+1, W[13]) - 1)*Math.exp(W[14]*(1-R)))
      : prev.s*(1 + Math.exp(W[8])*(11 - prev.d)*Math.pow(prev.s, -W[9])*(Math.exp(W[10]*(1-R)) - 1)*(g === 2 ? W[15] : 1)*(g === 4 ? W[16] : 1));
    return {s:Math.max(0.1, s), d};
  },
  next(c, g, now = Date.now()){
    const first = !c.reps || c.s == null;
    const {s, d} = this.step(this.W, first ? null : {s:c.s, d:c.d}, g, (now - (c.last || now)) / DAY);
    if (g === 1) return {s, d, due:now + 10*60000, days:0};
    const days = this.ivl(s);
    return {s, d, due:today().getTime() + days*DAY, days};
  },
  /* Lernverlauf (revlog: [kartenId, zeit, note, neu]) in Folgen pro Karte; nur Karten, deren erste Wiederholung im Verlauf liegt */
  sequences(items){
    const by = new Map();
    for (const [id, t, g, first] of items) { if (!by.has(id)) by.set(id, []); by.get(id).push([t, g, first]); }
    const out = [];
    for (const seq of by.values()) { seq.sort((a, b) => a[0] - b[0]); if (seq[0][2] && seq.length > 1) out.push(seq); }
    return out;
  },
  /* Mittlerer Log-Loss der Vorhersage "erinnert" über alle Wiederholungen mit mindestens einem halben Tag Abstand */
  loss(W, seqs){
    let sum = 0, n = 0;
    for (const seq of seqs) {
      let st = null, last = 0;
      for (const [t, g] of seq) {
        const el = (t - last) / DAY;
        if (st && el >= 0.5) { const R = clamp(this.r(el, st.s), 1e-4, 1 - 1e-4), y = g > 1 ? 1 : 0; sum -= y*Math.log(R) + (1-y)*Math.log(1-R); n++; }
        st = this.step(W, st, g, el); last = t;
      }
    }
    return {loss:n ? sum / n : 0, n};
  },
  /* Koordinatensuche mit leichter Bindung an die Standardwerte (verhindert Überanpassung bei wenig Daten) */
  async optimize(items, {iters = 30, onStep} = {}){
    const seqs = this.sequences(items), base = this.loss(this.DEFAULT, seqs);
    if (base.n < 200) return {ok:false, n:base.n};
    const lam = 50 / base.n, B = this.BOUNDS, D = this.DEFAULT;
    const obj = W => this.loss(W, seqs).loss + lam * W.reduce((a, w, i) => a + ((w - D[i]) / (B[i][1] - B[i][0])) ** 2, 0);
    let W = [...D], best = obj(W), step = 0.2;
    for (let it = 0; it < iters && step > 0.005; it++) {
      let improved = false;
      for (let i = 0; i < 17; i++) for (const dir of [1, -1]) {
        const T = [...W]; T[i] = clamp(T[i] + dir * step * (B[i][1] - B[i][0]) * 0.1, B[i][0], B[i][1]);
        const v = obj(T); if (v < best) { best = v; W = T; improved = true; }
      }
      if (!improved) step /= 2;
      onStep?.(it + 1, iters);
      await new Promise(r => setTimeout(r, 0));
    }
    return {ok:true, W:W.map(w => Math.round(w * 1e4) / 1e4), n:base.n, before:base.loss, after:this.loss(W, seqs).loss};
  }
};
const boxOf = c => !c.reps ? 0 : c.s < 1 ? 0 : c.s < 3 ? 1 : c.s < 7 ? 2 : c.s < 14 ? 3 : c.s < 30 ? 4 : 5;
const isNew = c => !c.reps;
const isDue = c => !!c.reps && (c.due || 0) <= Date.now();
const isMastered = c => !!c.reps && (c.s || 0) >= 14;
const isWeak = c => (c.lapses || 0) >= 2 || (!!c.reps && (c.lapses || 0) >= 1 && (c.s || 0) < 2);
