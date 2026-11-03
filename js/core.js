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
const defaultProfile = () => ({type:"profile", subjects:[], log:{}, exams:[], prompts:structuredClone(DEFAULT_PROMPTS), activePromptId:"p-standard", prefs:defaultPrefs()});
const freshUpload = (sid = "") => ({busy:false, stage:"", ctl:null, files:[], text:"", subjectId:sid, newSubject:"", error:"", promptId:""});

const S = {
  ready:false, store:"loading",
  profile:defaultProfile(), docs:{}, view:"heute", sel:{subject:null, doc:null, sheet:null},
  review:null, exam:null, duel:null, explain:null, share:null, importShare:null,
  upload:freshUpload(), confirm:null, busy:{}, examTab:"exam", auth:{email:"", busy:false, msg:""}
};

function normProfile(v){
  const p = {...defaultProfile(), ...v};
  p.prefs = {...defaultPrefs(), ...(v && v.prefs)};
  if (!arr(p.prompts).length) p.prompts = structuredClone(DEFAULT_PROMPTS);
  if (!p.prompts.find(x => x.id === p.activePromptId)) p.activePromptId = p.prompts[0].id;
  p.subjects = arr(p.subjects); p.exams = arr(p.exams); p.log = p.log || {};
  return p;
}
function normDoc(d){
  if (!arr(d.summaries).length && arr(d.summary).length) {
    d.summaries = [{id:rid("m"), promptName:"Kurzfassung", md:d.summary.map(x => "- "+x).join("\n"), createdAt:d.createdAt || Date.now()}];
  }
  d.summaries = arr(d.summaries);
  if (!d.activeSummary && d.summaries[0]) d.activeSummary = d.summaries[0].id;
  for (const c of arr(d.cards)) {
    if (!c.kind) c.kind = "basic";
    if (c.reps && c.s == null) { const legacy = [0,1,3,7,16,35][c.box || 0] || 1; c.s = Math.max(1, legacy); c.d = 5; c.last = (c.due || Date.now()) - c.s*DAY; }
  }
  return d;
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
  else if (v && v.type === "doc") S.docs[k] = normDoc(v);
}
async function loadAll(){
  const [keys, vals] = await Promise.all([tx("kv","readonly", st => st.getAllKeys()), tx("kv","readonly", st => st.getAll())]);
  keys.forEach((k, i) => applyValue(k, vals[i]));
}
function putLocal(id, data){ if (idb) return tx("kv","readwrite", st => st.put(structuredClone(data), id)).catch(e => toast(e && e.name === "QuotaExceededError" ? "Speicher voll. Lösche alte Dokumente." : "Speichern hat nicht geklappt.")); }
function save(id, data){ data._u = Date.now(); putLocal(id, data); Sync.markDirty(id); }
function remove(id){ if (idb) tx("kv","readwrite", st => st.delete(id)).catch(() => {}); Sync.markDeleted(id); removeImages(id); }
const saveProfile = () => save("profile", S.profile);

const imgUrls = new Map();
function saveImg(key, blob){ if (idb) return tx("img","readwrite", st => st.put(blob, key)).catch(() => {}); }
async function imgUrl(key){
  if (imgUrls.has(key)) return imgUrls.get(key);
  if (!idb) return null;
  const b = await tx("img","readonly", st => st.get(key)).catch(() => null);
  const u = b ? URL.createObjectURL(b) : null; imgUrls.set(key, u); return u;
}
async function removeImages(docId){
  if (!idb) return;
  const keys = await tx("img","readonly", st => st.getAllKeys()).catch(() => []);
  const mine = keys.filter(k => String(k).startsWith(docId+":"));
  if (mine.length) tx("img","readwrite", st => { mine.forEach(k => st.delete(k)); });
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
  valueOf(k){ return k === "profile" ? S.profile : S.docs[k]; },
  async push(){
    if (!this.uid || this.pushing) return;
    if (!this.dirty.size && !Object.keys(this.tombs).length) return;
    this.pushing = true; this.state = "syncing"; renderHeader();
    const sentTs = {}, sentTombs = {...this.tombs};
    try {
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
          if (local && r.ts >= lts) { if (r.key === "profile") continue; delete S.docs[r.key]; tx("kv","readwrite", st => st.delete(r.key)).catch(() => {}); removeImages(r.key); this.dirty.delete(r.key); changed = true; }
        } else if (!local || r.ts > lts) {
          applyValue(r.key, r.value); putLocal(r.key, r.value); this.dirty.delete(r.key); changed = true;
        } else if (lts > r.ts) this.dirty.add(r.key);
      }
      if (data.length < 500) break;
    }
    if (full) {
      for (const k of ["profile", ...Object.keys(S.docs)]) if (!seen.has(k) && (k !== "profile" || S.profile._u)) this.dirty.add(k);
    }
    if (maxSeen) LS.set(lkey, maxSeen);
    this.persist();
    return changed;
  },
  async full(){
    if (!this.uid || this.fullRunning) return;
    this.fullRunning = true; setTimeout(() => { this.fullRunning = false; }, 3000);
    this.state = "syncing"; renderHeader();
    try { const ch = await this.pull(true); this.state = "idle"; await this.push(); if (ch) softRender(); }
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
async function callClaude({messages, maxTokens = 8000, signal, onText}){
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
  try { res = await fetch(url, {method:"POST", signal, headers, body:JSON.stringify({model:settings.model, max_tokens:maxTokens, stream:true, messages})}); }
  catch (e) { throw new AIError(e.name === "AbortError" ? "cancelled" : "network", e.message); }
  if (!res.ok) {
    let msg = ""; try { const j = await res.json(); msg = j?.error?.message || j?.message || j?.msg || ""; } catch {}
    const base = {400:"bad_request", 401:"auth", 403:"auth", 404:"model", 413:"too_large", 429:"rate_limited", 529:"overloaded"};
    let code = base[res.status] || (res.status >= 500 ? "overloaded" : "bad_request");
    if (src === "proxy" && res.status === 401) code = "proxy_auth";
    if (src === "proxy" && res.status === 403) code = "proxy_forbidden";
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
async function askJSON(prompt, {images = [], pdfs = [], signal, maxTokens = 8000, onProgress} = {}){
  const content = [
    ...pdfs.map(data => ({type:"document", source:{type:"base64", media_type:"application/pdf", data}})),
    ...(await Promise.all(images.map(async b => ({type:"image", source:{type:"base64", media_type:"image/jpeg", data: await blobToB64(b)}})))),
    {type:"text", text: prompt + "\n\nAntworte ausschließlich mit dem JSON, ohne Text davor oder danach. Backslashes in LaTeX müssen im JSON verdoppelt werden (\\\\frac)."}
  ];
  const t = await callClaude({messages:[{role:"user", content}], maxTokens, signal, onText: x => onProgress?.(x.length)});
  return parseJSON(t);
}
const askText = (prompt, opts = {}) => callClaude({messages:[{role:"user", content:prompt}], ...opts});

function errText(e){
  const m = {
    no_key:"Claude ist noch nicht eingerichtet. Hinterlege in den Einstellungen einen API-Schlüssel oder melde dich an und nutze deinen Server.",
    auth:"Der API-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen.",
    proxy_auth:"Deine Anmeldung ist abgelaufen. Melde dich in den Einstellungen neu an.",
    proxy_forbidden:"Dein Konto ist für den Server nicht freigeschaltet. Trag deine E-Mail in ALLOWED_EMAILS ein (siehe Anleitung).",
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
  W:[0.4872,1.4003,3.7145,13.8206,5.1618,1.2298,0.8975,0.031,1.6474,0.1367,1.0461,2.1072,0.0793,0.3246,1.587,0.2272,2.8755],
  DECAY:-0.5, FACTOR:19/81,
  r(t, s){ return Math.pow(1 + this.FACTOR*t/s, this.DECAY); },
  ivl(s){ const r = clamp(S.profile.prefs.retention || 0.9, 0.7, 0.97); return clamp(Math.round(s/this.FACTOR*(Math.pow(r, 1/this.DECAY) - 1)), 1, 365); },
  d0(g){ return clamp(this.W[4] - (g-3)*this.W[5], 1, 10); },
  /* g: 1 Nochmal, 2 Schwer, 3 Gut, 4 Leicht */
  next(c, g, now = Date.now()){
    const W = this.W; let s, d;
    if (!c.reps || c.s == null) { s = W[g-1]; d = this.d0(g); }
    else {
      const t = Math.max(0, (now - (c.last || now)) / DAY), R = this.r(t, c.s);
      d = clamp(W[7]*this.d0(4) + (1-W[7])*(c.d - W[6]*(g-3)), 1, 10);
      if (g === 1) s = Math.min(c.s, W[11]*Math.pow(c.d, -W[12])*(Math.pow(c.s+1, W[13]) - 1)*Math.exp(W[14]*(1-R)));
      else s = c.s*(1 + Math.exp(W[8])*(11 - c.d)*Math.pow(c.s, -W[9])*(Math.exp(W[10]*(1-R)) - 1)*(g === 2 ? W[15] : 1)*(g === 4 ? W[16] : 1));
    }
    s = Math.max(0.1, s);
    if (g === 1) return {s, d, due:now + 10*60000, days:0};
    const days = this.ivl(s);
    return {s, d, due:today().getTime() + days*DAY, days};
  }
};
const boxOf = c => !c.reps ? 0 : c.s < 1 ? 0 : c.s < 3 ? 1 : c.s < 7 ? 2 : c.s < 14 ? 3 : c.s < 30 ? 4 : 5;
const isNew = c => !c.reps;
const isDue = c => !!c.reps && (c.due || 0) <= Date.now();
const isMastered = c => !!c.reps && (c.s || 0) >= 14;
const isWeak = c => (c.lapses || 0) >= 2 || (!!c.reps && (c.lapses || 0) >= 1 && (c.s || 0) < 2);
