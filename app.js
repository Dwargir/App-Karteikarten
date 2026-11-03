"use strict";
/* Semesterkartei – läuft komplett im Browser.
   Daten: IndexedDB (nur auf diesem Gerät). KI: Anthropic Messages API mit eigenem API-Schlüssel. */

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const arr = v => Array.isArray(v) ? v : [];
const DAY = 864e5;
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const dkey = (d = new Date()) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const rid = p => p+"-"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const INTERVALS = [0,1,3,7,16,35];
const SUBJ_COLORS = 6;
const MAX_IMAGES = 20;
const MODELS = [
  {id:"claude-sonnet-5-5", label:"Claude Sonnet 5.5 (empfohlen)"},
  {id:"claude-haiku-5-5", label:"Claude Haiku 5.5 (schnell, günstig)"},
  {id:"claude-opus-5-5", label:"Claude Opus 5.5 (am gründlichsten)"}
];
const fmtDays = n => n <= 0 ? "gleich" : n === 1 ? "1 Tag" : n+" Tage";
const daysUntil = ds => Math.round((new Date(ds+"T00:00:00") - today())/DAY);
const fmtDate = t => new Date(t).toLocaleDateString("de-DE",{day:"numeric",month:"short"});
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const defaultProfile = () => ({type:"profile", subjects:[], log:{}, exams:[]});
const freshUpload = (sid="") => ({busy:false, stage:"", ctl:null, files:[], text:"", subjectId:sid, newSubject:"", error:""});

const S = {
  ready:false, store:"loading",
  profile:defaultProfile(), docs:{}, view:"heute", sel:{subject:null, doc:null},
  review:null, exam:null, upload:freshUpload(), confirm:null, moreBusy:null
};

/* ---------- Einstellungen (localStorage) ---------- */
const settings = {
  get key(){ try { return localStorage.getItem("sk.apiKey") || ""; } catch { return ""; } },
  set key(v){ try { v ? localStorage.setItem("sk.apiKey", v) : localStorage.removeItem("sk.apiKey"); } catch {} },
  get model(){ try { return localStorage.getItem("sk.model") || MODELS[0].id; } catch { return MODELS[0].id; } },
  set model(v){ try { localStorage.setItem("sk.model", v); } catch {} }
};
const hasKey = () => !!settings.key;

/* ---------- Speicher (IndexedDB) ---------- */
let idb = null;
function openDb(){
  return new Promise((res, rej) => {
    const r = indexedDB.open("semesterkartei", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function tx(mode, fn){
  return new Promise((res, rej) => {
    const t = idb.transaction("kv", mode), st = t.objectStore("kv");
    const out = fn(st);
    t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
async function loadAll(){
  const [keys, vals] = await Promise.all([tx("readonly", st => st.getAllKeys()), tx("readonly", st => st.getAll())]);
  keys.forEach((k, i) => {
    const v = vals[i];
    if (k === "profile") S.profile = {...defaultProfile(), ...v};
    else if (v && v.type === "doc") S.docs[k] = v;
  });
}
function save(id, data){
  if (!idb) return;
  tx("readwrite", st => st.put(structuredClone(data), id)).catch(e => {
    toast(e && e.name === "QuotaExceededError" ? "Speicher voll. Lösche alte Dokumente." : "Speichern hat nicht geklappt.");
  });
}
function remove(id){ if (idb) tx("readwrite", st => st.delete(id)).catch(() => toast("Löschen hat nicht geklappt.")); }
const saveProfile = () => save("profile", S.profile);

/* ---------- Claude (Anthropic API) ---------- */
class AIError extends Error { constructor(code, message){ super(message); this.code = code; } }
const blobToB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function shrinkImage(file){
  // Große Handyfotos auf max. 1568 px verkleinern (API-Limit 5 MB pro Bild)
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas");
  cv.width = Math.round(bmp.width*scale); cv.height = Math.round(bmp.height*scale);
  cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
  const blob = await new Promise(r => cv.toBlob(r, "image/jpeg", .86));
  return {type:"image", source:{type:"base64", media_type:"image/jpeg", data: await blobToB64(blob)}};
}
function parseJSON(text){
  const t = text.trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = t.search(/[[{]/), b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b+1)); } catch {} }
  throw new AIError("invalid_json", "Antwort war kein gültiges JSON");
}
async function askJSON(prompt, {images = [], pdfs = [], signal, maxTokens = 8000, onProgress} = {}){
  if (!hasKey()) throw new AIError("no_key", "Kein API-Schlüssel");
  const content = [
    ...pdfs.map(data => ({type:"document", source:{type:"base64", media_type:"application/pdf", data}})),
    ...images,
    {type:"text", text: prompt + "\n\nAntworte ausschließlich mit dem JSON, ohne Text davor oder danach."}
  ];
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST", signal,
      headers:{
        "content-type":"application/json",
        "x-api-key":settings.key,
        "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true"
      },
      body: JSON.stringify({model:settings.model, max_tokens:maxTokens, stream:true, messages:[{role:"user", content}]})
    });
  } catch (e) {
    if (e.name === "AbortError") throw new AIError("cancelled", "Abgebrochen");
    throw new AIError("network", "Keine Verbindung");
  }
  if (!res.ok) {
    let msg = ""; try { msg = (await res.json())?.error?.message || ""; } catch {}
    const code = {400:"bad_request", 401:"auth", 403:"auth", 404:"model", 413:"too_large", 429:"rate_limited", 529:"overloaded"}[res.status] || (res.status >= 500 ? "overloaded" : "bad_request");
    throw new AIError(code, msg || ("HTTP " + res.status));
  }
  // Server-Sent Events lesen, damit Fortschritt angezeigt werden kann
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
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { text += ev.delta.text; onProgress?.(text.length); }
        else if (ev.type === "message_delta" && ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === "error") throw new AIError(ev.error?.type === "overloaded_error" ? "overloaded" : "bad_request", ev.error?.message || "Fehler");
      }
    }
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e.name === "AbortError") throw new AIError("cancelled", "Abgebrochen");
    throw new AIError("network", "Verbindung abgebrochen");
  }
  if (stop === "max_tokens") throw new AIError("truncated", "Antwort zu lang");
  if (stop === "refusal") throw new AIError("refused", "Abgelehnt");
  return parseJSON(text);
}

/* ---------- Helfer ---------- */
const subj = id => S.profile.subjects.find(s => s.id === id);
const docsOf = sid => Object.entries(S.docs).filter(([,d]) => d.subjectId === sid).sort((a,b)=>b[1].createdAt-a[1].createdAt);
function allCards(filter){
  const out = [];
  for (const [id,d] of Object.entries(S.docs)) { if (filter && !filter(id,d)) continue; for (const c of arr(d.cards)) out.push({docId:id, c}); }
  return out;
}
const isDue = c => (c.due || 0) <= Date.now();
const scopeFilter = scope => !scope || scope === "all" ? null : scope.startsWith("d:") ? (id => id === scope.slice(2)) : ((id,d) => d.subjectId === scope.slice(2));
const newCard = (q,a) => ({id:rid("c"), q:String(q).trim(), a:String(a).trim(), box:0, due:0, reps:0, lapses:0});
function addSubject(name){
  const s = {id:rid("s"), name:name.trim().slice(0,60), color:S.profile.subjects.length % SUBJ_COLORS, examDate:""};
  S.profile.subjects.push(s); saveProfile(); return s.id;
}
function lvl(box){ let h='<span class="lvl" aria-label="Stufe '+((box||0)+1)+' von 6">'; for (let i=0;i<6;i++) h+='<i class="'+(i<=(box||0)?"on":"")+'"></i>'; return h+"</span>"; }
const subjDot = s => '<span class="dot" style="--c:var(--s'+(s ? s.color : 0)+')"></span>';
function stats(){
  const cards = allCards(), log = S.profile.log || {};
  let streak = 0; const d = today();
  if (!(log[dkey(d)]?.n)) d.setDate(d.getDate()-1);
  while (log[dkey(d)]?.n) { streak++; d.setDate(d.getDate()-1); }
  return {
    total:cards.length, due:cards.filter(x=>isDue(x.c)).length,
    mastered:cards.filter(x=>(x.c.box||0)>=4).length, learned:cards.filter(x=>x.c.reps).length,
    streak, todayN:log[dkey()]?.n || 0
  };
}
function errText(e){
  const m = {
    no_key:"Hinterlege zuerst deinen Anthropic-API-Schlüssel in den Einstellungen (Zahnrad oben rechts).",
    auth:"Der API-Schlüssel wurde abgelehnt. Prüfe ihn in den Einstellungen.",
    model:"Das gewählte Modell ist für deinen Schlüssel nicht verfügbar. Wähle in den Einstellungen ein anderes.",
    rate_limited:"Zu viele Anfragen oder dein API-Guthaben ist aufgebraucht. Versuch es in ein paar Minuten noch einmal.",
    overloaded:"Claude ist gerade überlastet. Versuch es gleich noch einmal.",
    too_large:"Das Material ist zu groß. Lade es in kleineren Teilen hoch.",
    network:"Keine Verbindung zu Claude. Prüfe deine Internetverbindung.",
    invalid_json:"Die Antwort kam unvollständig an. Tippe noch einmal auf den Button.",
    truncated:"Die Antwort war zu lang und wurde abgeschnitten. Versuch es mit weniger Material.",
    refused:"Claude hat dieses Material abgelehnt. Versuch es mit einem anderen Ausschnitt."
  };
  if (e && e.code === "bad_request") return "Anfrage abgelehnt: " + e.message;
  if (e && m[e.code]) return m[e.code];
  if (e && e.code === "local") return e.message;
  if (e instanceof Error) return e.message;
  return "Etwas ist schiefgelaufen. Versuch es noch einmal.";
}
let toastT;
function toast(msg){
  let el = $(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role","status"); document.body.append(el); }
  el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(()=>{ el.hidden = true; }, 2600);
}

/* ---------- Dokumente lesen ---------- */
async function extractFile(f){
  const name = f.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    if (!window.pdfjsLib) throw {code:"local", message:"Der PDF-Leser konnte nicht geladen werden. Lade die Seite neu."};
    const buf = await f.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: buf.slice(0)}).promise;
    let text = "";
    for (let i=1; i<=pdf.numPages && text.length < 120000; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      text += "\n[Seite "+i+"]\n" + tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("");
    }
    const letters = text.replace(/\[Seite \d+\]|\s/g,"").length;
    if (letters < 60 * Math.min(pdf.numPages, 5)) {
      // Gescanntes PDF: direkt als Dokument an Claude schicken (max. 100 Seiten, 32 MB)
      if (f.size > 30e6 || pdf.numPages > 100) throw {code:"local", message:"Dieses gescannte PDF ist zu groß. Teile es in kleinere Dateien (max. 100 Seiten)."};
      return {text:"", pdf: await blobToB64(f)};
    }
    return {text};
  }
  if (name.endsWith(".docx")) {
    if (!window.mammoth) throw {code:"local", message:"Der Word-Leser konnte nicht geladen werden. Exportiere die Datei als PDF."};
    return {text:(await mammoth.extractRawText({arrayBuffer: await f.arrayBuffer()})).value};
  }
  if (/\.(txt|md|csv|tex|rtf)$/.test(name)) return {text: await f.text()};
  if (/\.(pptx?|key)$/.test(name)) throw {code:"local", message:"Folien bitte als PDF exportieren und dann hochladen."};
  throw {code:"local", message:"Dieses Format kann die App nicht lesen: "+f.name+". Nimm PDF, Word, Text oder Fotos."};
}

/* ---------- Prompts ---------- */
function genPrompt(subject, fileName, text, nAttach){
  return `Du bist ein Lerncoach für Studierende. Erstelle aus dem folgenden Uni-Material Lernmaterial. Schreibe in der Sprache des Materials (meist Deutsch).

Antworte NUR mit einem JSON-Objekt in genau dieser Form:
{"title":"kurzer, sprechender Titel (max. 8 Wörter)","summary":["5 bis 8 Stichpunkte, die das Wichtigste zusammenfassen"],"topics":["3 bis 6 Schlagworte"],"cards":[{"q":"Frage","a":"Antwort"}],"videos":[{"title":"Wonach suchen","query":"präziser YouTube-Suchbegriff","why":"Warum das hilft (1 Satz)"}]}

Regeln für die Karteikarten:
- 12 bis 30 Karten, je nach Umfang des Materials.
- Pro Karte genau eine Frage. Antworten knapp: höchstens 2-3 Sätze oder eine Formel mit kurzer Erklärung.
- Decke Definitionen, Zusammenhänge, Formeln, Abläufe und Beispiele ab. Frage nach Verständnis, nicht nur nach Wortlaut.
- Keine Karten zu Organisatorischem (Termine, Folienzahlen, Literaturlisten).
Videos: 3 bis 5 Vorschläge mit Suchbegriffen, die bei YouTube gute Erklärvideos zu den Kernthemen finden.

Fach: ${subject}
Datei: ${fileName}
${nAttach ? `Dazu kommen ${nAttach} Anhänge (Fotos, Scans oder PDF) der Unterlagen. Lies ihren Inhalt sorgfältig.\n` : ""}
MATERIAL:
"""
${text || "(siehe Anhänge)"}
"""`;
}
function morePrompt(d){
  return `Erstelle 10 weitere Karteikarten zum folgenden Uni-Material. Sie dürfen sich NICHT mit den vorhandenen Karten überschneiden; gehe tiefer oder decke Lücken ab. Gleiche Sprache wie das Material.
Antworte NUR mit JSON: {"cards":[{"q":"Frage","a":"knappe Antwort"}]}

Vorhandene Fragen:
${arr(d.cards).map(c=>"- "+c.q).join("\n")}

MATERIAL:
"""
${(d.text||"").slice(0,40000) || arr(d.summary).join("\n")}
"""`;
}
function material(scope){
  const f = scopeFilter(scope);
  const ids = Object.keys(S.docs).filter(id => !f || f(id, S.docs[id]));
  const per = Math.floor(60000 / Math.max(ids.length,1));
  let m = "";
  for (const id of ids) {
    const d = S.docs[id];
    m += `\n## ${d.title}\nZusammenfassung:\n- ${arr(d.summary).join("\n- ")}\nKarteikarten:\n` + arr(d.cards).map(c=>`F: ${c.q}\nA: ${c.a}`).join("\n") + (d.text ? "\nAuszug aus dem Original:\n"+d.text.slice(0, per) : "") + "\n";
  }
  return m.slice(0, 150000);
}

/* ---------- Upload & Generierung ---------- */
async function genStart(){
  const U = S.upload; U.error = "";
  if (!hasKey()) { U.error = errText({code:"no_key"}); return renderMain(); }
  let sid = U.subjectId || (S.profile.subjects[0]?.id ?? "");
  if (sid === "__new" || !S.profile.subjects.length) {
    const n = (U.newSubject || "").trim();
    if (!n) { U.error = "Gib dem neuen Fach einen Namen."; return renderMain(); }
    sid = addSubject(n);
  }
  if (!U.files.length && !U.text.trim()) { U.error = "Wähle eine Datei oder füge Text ein."; return renderMain(); }
  U.subjectId = sid; U.busy = true; U.stage = "Dokument wird gelesen…"; renderMain();
  try {
    let text = U.text.trim();
    const images = [], pdfs = [];
    const name = U.files[0]?.name || "Eingefügter Text";
    for (const f of U.files) {
      if (f.type.startsWith("image/")) { if (images.length < MAX_IMAGES) images.push(await shrinkImage(f)); continue; }
      const r = await extractFile(f);
      text += "\n\n" + (r.text || ""); if (r.pdf) pdfs.push(r.pdf);
    }
    if (text.replace(/\s/g,"").length < 60 && !images.length && !pdfs.length) throw {code:"local", message:"In der Datei wurde kaum Text gefunden. Fotografiere die Seiten und lade die Bilder hoch."};
    text = text.trim().slice(0, 90000);
    U.stage = "Claude liest das Material und erstellt Karteikarten…"; renderStage();
    const ctl = new AbortController(); U.ctl = ctl;
    const out = await askJSON(genPrompt(subj(sid)?.name || "", name, text, images.length + pdfs.length), {
      images, pdfs, signal:ctl.signal,
      onProgress: n => { U.stage = "Karteikarten entstehen… " + n.toLocaleString("de-DE") + " Zeichen"; renderStage(); }
    });
    const cards = arr(out?.cards).filter(c => c && c.q && c.a).map(c => newCard(c.q, c.a));
    if (!cards.length) throw {code:"local", message:"Claude hat keine Karten geliefert. Versuch es noch einmal oder mit weniger Material."};
    const id = rid("d");
    const doc = {
      type:"doc", subjectId:sid, title:String(out.title || name).slice(0,140), fileName:name, createdAt:Date.now(),
      summary:arr(out.summary).map(String).slice(0,12), topics:arr(out.topics).map(String).slice(0,8),
      videos:arr(out.videos).filter(v => v && v.query).slice(0,6).map(v => ({title:String(v.title||v.query), query:String(v.query), why:String(v.why||"")})),
      cards, text:(text || arr(out.summary).join("\n")).slice(0,40000)
    };
    S.docs[id] = doc; save(id, doc);
    S.upload = freshUpload(sid);
    S.view = "faecher"; S.sel = {subject:sid, doc:id};
    toast(cards.length + " Karteikarten erstellt");
    render(); scrollTo(0,0);
  } catch (e) {
    U.busy = false; U.ctl = null; U.stage = "";
    if (!e || e.code !== "cancelled") U.error = errText(e);
    renderMain();
  }
}
async function moreCards(id){
  const d = S.docs[id]; if (!d) return;
  if (!hasKey()) { toast("Erst API-Schlüssel in den Einstellungen hinterlegen."); return; }
  S.moreBusy = id; renderMain();
  try {
    const out = await askJSON(morePrompt(d), {maxTokens:4000});
    const add = arr(out?.cards).filter(c => c && c.q && c.a).map(c => newCard(c.q, c.a));
    const cur = S.docs[id]; if (cur) { cur.cards = [...arr(cur.cards), ...add]; save(id, cur); }
    toast(add.length + " neue Karten");
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.moreBusy = null; renderMain();
}

/* ---------- Abfrage ---------- */
function startReview(scope, everything){
  let items = allCards(scopeFilter(scope));
  if (!everything) items = items.filter(x => isDue(x.c));
  if (!items.length) { toast("Gerade ist nichts fällig."); return; }
  items = shuffle(items).slice(0, everything ? 60 : 40);
  S.review = {queue:items.map(x => ({docId:x.docId, cardId:x.c.id})), total:items.length, done:0, shown:false, counts:[0,0,0,0], scope};
  S.view = "review"; render(); scrollTo(0,0);
}
function curCard(){
  const R = S.review; if (!R) return null;
  while (R.queue.length) {
    const it = R.queue[0], d = S.docs[it.docId], c = d && arr(d.cards).find(c => c.id === it.cardId);
    if (c) return {d, c, it};
    R.queue.shift();
  }
  return null;
}
function nextBox(c, g){ const b = c.box || 0; return g === 0 ? 0 : g === 1 ? Math.max(1, b) : g === 2 ? Math.min(5, b+1) : Math.min(5, b+2); }
function grade(g){
  const R = S.review, cur = curCard(); if (!cur || !R.shown) return;
  const {c, it} = cur;
  c.reps = (c.reps||0) + 1; c.box = nextBox(c, g);
  if (g === 0) { c.lapses = (c.lapses||0) + 1; c.due = Date.now(); }
  else c.due = today().getTime() + INTERVALS[c.box]*DAY;
  save(it.docId, S.docs[it.docId]);
  const k = dkey(), log = S.profile.log || (S.profile.log = {});
  log[k] = {n:(log[k]?.n||0)+1, ok:(log[k]?.ok||0)+(g>0?1:0)};
  const keys = Object.keys(log).sort(); while (keys.length > 120) delete log[keys.shift()];
  saveProfile();
  R.counts[g]++; R.queue.shift();
  if (g === 0) R.queue.splice(Math.min(R.queue.length, 3), 0, it); else R.done++;
  R.shown = false; renderMain();
}

/* ---------- Klausur ---------- */
async function examStart(){
  const E = S.exam;
  if (!hasKey()) { E.error = errText({code:"no_key"}); return renderMain(); }
  const m = material(E.scope);
  if (!m.trim()) { E.error = "Für diese Auswahl gibt es noch kein Material."; return renderMain(); }
  E.stage = "loading"; E.error = ""; E.ctl = new AbortController(); renderMain();
  try {
    const out = await askJSON(`Erstelle eine Übungsklausur mit ${E.n} Aufgaben auf Uni-Niveau aus dem folgenden Lernmaterial. Mische etwa 60 % Multiple Choice (genau 4 Optionen, genau eine richtig) und 40 % offene Aufgaben. Prüfe Verständnis und Anwendung, nicht nur Auswendiglernen. Gleiche Sprache wie das Material.
Antworte NUR mit JSON: {"questions":[{"type":"mc","q":"Frage","options":["A","B","C","D"],"correct":0,"explain":"warum diese Antwort stimmt (1-2 Sätze)"},{"type":"open","q":"Aufgabe","model":"Musterlösung in 2-5 Sätzen","points":4}]}

MATERIAL:
${m}`, {signal:E.ctl.signal});
    const qs = arr(out?.questions).filter(q => q && q.q && (q.type === "open" || (arr(q.options).length >= 2 && Number.isInteger(q.correct))));
    if (!qs.length) throw {code:"local", message:"Es kamen keine brauchbaren Aufgaben zurück. Versuch es noch einmal."};
    E.questions = qs.map(q => q.type === "open" ? {type:"open", q:String(q.q), model:String(q.model||""), points:Math.max(1, Math.min(10, Number(q.points)||4))} : {type:"mc", q:String(q.q), options:arr(q.options).map(String), correct:q.correct, explain:String(q.explain||""), points:1});
    E.answers = {}; E.stage = "taking";
  } catch (e) { E.stage = "setup"; if (e?.code !== "cancelled") E.error = errText(e); }
  renderMain(); scrollTo(0,0);
}
async function examSubmit(){
  const E = S.exam; E.stage = "grading"; E.ctl = new AbortController(); renderMain();
  const res = E.questions.map((q,i) => q.type === "mc" ? {score: E.answers[i] === q.correct ? 1 : 0} : {score:0, feedback:""});
  const open = E.questions.map((q,i) => ({i, q})).filter(x => x.q.type === "open");
  const answered = open.filter(x => String(E.answers[x.i]||"").trim());
  open.filter(x => !String(E.answers[x.i]||"").trim()).forEach(x => res[x.i].feedback = "Keine Antwort abgegeben.");
  if (answered.length) {
    try {
      const out = await askJSON(`Du bist Tutor und korrigierst offene Klausuraufgaben fair und konkret. Vergib für jede Antwort Punkte zwischen 0 und der Maximalpunktzahl (halbe Punkte erlaubt) und schreibe 1-2 Sätze Feedback: was gut war und was fehlt. Gleiche Sprache wie die Aufgabe.
Antworte NUR mit JSON: {"results":[{"i":0,"score":2.5,"feedback":"..."}]}

AUFGABEN:
${JSON.stringify(answered.map(x => ({i:x.i, aufgabe:x.q.q, musterloesung:x.q.model, maxPunkte:x.q.points, antwort:String(E.answers[x.i]).slice(0,4000)})))}`, {signal:E.ctl.signal, maxTokens:4000});
      for (const r of arr(out?.results)) { const q = E.questions[r.i]; if (q && q.type === "open") res[r.i] = {score:Math.max(0, Math.min(q.points, Number(r.score)||0)), feedback:String(r.feedback||"")}; }
    } catch (e) {
      if (e?.code === "cancelled") { E.stage = "taking"; return renderMain(); }
      answered.forEach(x => res[x.i].feedback = "Konnte nicht automatisch bewertet werden: " + errText(e) + " Vergleiche selbst mit der Musterlösung.");
    }
  }
  E.results = res;
  const max = E.questions.reduce((s,q) => s+q.points, 0), got = res.reduce((s,r) => s+r.score, 0);
  E.pct = Math.round(got/max*100);
  S.profile.exams = [{date:Date.now(), scope:E.scope, label:scopeLabel(E.scope), pct:E.pct}, ...arr(S.profile.exams)].slice(0,20);
  saveProfile();
  E.stage = "done"; renderMain(); scrollTo(0,0);
}
function scopeLabel(sc){
  if (!sc || sc === "all") return "Alle Fächer";
  if (sc.startsWith("s:")) return subj(sc.slice(2))?.name || "Fach";
  return S.docs[sc.slice(2)]?.title || "Dokument";
}

/* ---------- Backup ---------- */
function exportBackup(){
  const data = JSON.stringify({app:"semesterkartei", version:1, exportedAt:new Date().toISOString(), profile:S.profile, docs:S.docs});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], {type:"application/json"}));
  a.download = "semesterkartei-backup-" + dkey() + ".json";
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importBackup(file){
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== "semesterkartei" || !d.profile || typeof d.docs !== "object") throw new Error();
    S.profile = {...defaultProfile(), ...d.profile}; saveProfile();
    for (const [id, doc] of Object.entries(d.docs)) if (doc && doc.type === "doc") { S.docs[id] = doc; save(id, doc); }
    toast("Backup importiert"); S.view = "heute"; render();
  } catch { toast("Diese Datei ist kein gültiges Semesterkartei-Backup."); }
}
async function wipeAll(){
  if (idb) await tx("readwrite", st => st.clear()).catch(() => {});
  S.profile = defaultProfile(); S.docs = {}; S.confirm = null;
  toast("Alle Daten gelöscht"); S.view = "heute"; render();
}

/* ---------- Beispiel ---------- */
function loadExample(){
  const sid = addSubject("Biologie (Beispiel)");
  const cards = [
    ["Wo findet die Glykolyse statt?","Im Cytoplasma der Zelle."],
    ["Was ist die Bruttogleichung der Zellatmung?","C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O; dabei wird Energie in Form von ATP frei."],
    ["Wie viele ATP liefert die Glykolyse netto pro Glucose?","2 ATP (dazu 2 NADH + H⁺)."],
    ["Wo läuft der Citratzyklus ab?","In der Matrix der Mitochondrien."],
    ["Welche Rolle spielt Sauerstoff in der Atmungskette?","Er ist der letzte Elektronenakzeptor und wird zu Wasser reduziert."],
    ["Was treibt die ATP-Synthase an?","Der Protonengradient über der inneren Mitochondrienmembran (Chemiosmose)."],
    ["Was passiert mit Pyruvat ohne Sauerstoff?","Es wird vergoren, z. B. zu Laktat oder zu Ethanol und CO₂, um NAD⁺ zu regenerieren."],
    ["Was ist oxidative Decarboxylierung?","Umwandlung von Pyruvat zu Acetyl-CoA; dabei werden CO₂ und NADH frei."]
  ].map(([q,a]) => newCard(q,a));
  const id = rid("d");
  S.docs[id] = {type:"doc", subjectId:sid, title:"Beispiel: Zellatmung", fileName:"Beispiel", createdAt:Date.now(),
    summary:["Zellatmung gewinnt aus Glucose Energie in Form von ATP.","Vier Schritte: Glykolyse, oxidative Decarboxylierung, Citratzyklus, Atmungskette.","Die Glykolyse läuft im Cytoplasma, der Rest in den Mitochondrien.","Die meiste Energie liefert die Atmungskette über den Protonengradienten.","Ohne Sauerstoff bleibt nur die Gärung mit geringer ATP-Ausbeute."],
    topics:["Glykolyse","Citratzyklus","Atmungskette","ATP","Gärung"],
    videos:[{title:"Zellatmung im Überblick",query:"Zellatmung einfach erklärt",why:"Zeigt alle vier Schritte im Zusammenhang."},{title:"Atmungskette und ATP-Synthase",query:"Atmungskette ATP Synthase Animation",why:"Die Chemiosmose versteht man am besten animiert."},{title:"Citratzyklus Schritt für Schritt",query:"Citratzyklus Schritt für Schritt erklärt",why:"Für die Details, die in Klausuren gern abgefragt werden."}],
    cards, text:"Zellatmung: Glykolyse im Cytoplasma, oxidative Decarboxylierung, Citratzyklus in der Mitochondrienmatrix, Atmungskette an der inneren Mitochondrienmembran. Gärung ohne Sauerstoff."};
  save(id, S.docs[id]);
  S.view = "faecher"; S.sel = {subject:sid, doc:id}; render();
}

/* ---------- Ansichten ---------- */
function vLoading(){ return '<div class="panel row"><span class="spinner"></span><span>Deine Kartei wird geladen…</span></div>'; }
function storeNotice(){
  if (S.store === "memory") return '<div class="notice">Dein Browser erlaubt hier keine Speicherung (z. B. privater Modus). Deine Karten gehen beim Schließen verloren.</div>';
  return "";
}
function keyNotice(){
  return hasKey() ? "" : '<div class="notice">Damit Claude Karteikarten und Klausuren erstellen kann, brauchst du einen eigenen Anthropic-API-Schlüssel. <button class="ghost" style="min-height:0;padding:0;color:var(--accent)" data-act="nav" data-v="settings">Jetzt einrichten →</button></div>';
}
function vHeute(){
  if (!S.ready) return vLoading();
  const st = stats();
  const dateStr = new Date().toLocaleDateString("de-DE",{weekday:"long", day:"numeric", month:"long"});
  if (!Object.keys(S.docs).length) return storeNotice() + keyNotice() + `
    <div><p class="eyebrow">${esc(dateStr)}</p><h1>Dein Karteikasten ist noch leer</h1></div>
    <div class="paper empty">
      <h2 style="margin-top:4px">So funktioniert's</h2>
      <p>Lade ein Skript, Folien als PDF oder Fotos deiner Mitschrift hoch. Claude erstellt daraus Karteikarten, eine Zusammenfassung und passende Erklärvideos. Danach fragt dich die App jeden Tag die Karten ab, die gerade fällig sind.</p>
      <div class="row"><button class="primary" data-act="nav" data-v="upload">Erstes Dokument hochladen</button><button data-act="example">Beispiel ansehen</button></div>
    </div>`;
  const exams = S.profile.subjects.filter(s => s.examDate && daysUntil(s.examDate) >= 0).sort((a,b) => daysUntil(a.examDate) - daysUntil(b.examDate));
  const recent = Object.entries(S.docs).sort((a,b) => b[1].createdAt - a[1].createdAt).slice(0,4);
  return storeNotice() + `
    <div><p class="eyebrow">${esc(dateStr)}</p><h1>${st.due ? "Heute stehen Karten an" : "Für heute alles gelernt"}</h1></div>
    <div class="paper hero">
      <div class="row between" style="height:20px"><span class="eyebrow">Fällig</span><span class="eyebrow num">${st.todayN} heute gelernt</span></div>
      <div class="row between" style="align-items:flex-end;margin-top:14px">
        <div><div class="big num">${st.due}</div><p class="muted">${st.due === 1 ? "Karte wartet" : "Karten warten"} auf dich</p></div>
        <button class="primary" data-act="review" data-v="all" ${st.due ? "" : "disabled"}>Jetzt lernen</button>
      </div>
      ${st.due ? "" : '<button data-act="reviewAll" data-v="all">Trotzdem alle Karten üben</button>'}
    </div>
    <div class="statrow">
      <div class="stat"><b>${st.streak}</b><span>${st.streak === 1 ? "Tag" : "Tage"} in Folge</span></div>
      <div class="stat"><b>${st.total}</b><span>Karten gesamt</span></div>
      <div class="stat"><b>${st.total ? Math.round(st.mastered/st.total*100) : 0} %</b><span>sicher gelernt</span></div>
    </div>
    ${exams.length ? `<section class="stack"><h2>Nächste Prüfungen</h2><div class="list">${exams.slice(0,4).map(s => {
      const n = daysUntil(s.examDate), due = allCards((id,d) => d.subjectId === s.id).filter(x => isDue(x.c)).length;
      return `<button class="item" data-act="openSubj" data-v="${esc(s.id)}">${subjDot(s)}<span class="grow"><span class="t">${esc(s.name)}</span><br><span class="s">${new Date(s.examDate+"T00:00").toLocaleDateString("de-DE",{weekday:"short",day:"numeric",month:"long"})}${due ? " · "+due+" fällig" : ""}</span></span><span class="pill ${n<=7?"due":""}">${n === 0 ? "heute" : "in "+n+" T"}</span></button>`;
    }).join("")}</div></section>` : ""}
    <section class="stack"><div class="row between"><h2>Zuletzt hochgeladen</h2><button class="ghost" data-act="nav" data-v="faecher">Alle Fächer</button></div>
    <div class="list">${recent.map(([id,d]) => docItem(id,d)).join("")}</div></section>`;
}
function docItem(id, d){
  const s = subj(d.subjectId), due = arr(d.cards).filter(isDue).length;
  return `<button class="item" data-act="openDoc" data-v="${esc(id)}">${subjDot(s)}<span class="grow"><span class="t">${esc(d.title)}</span><br><span class="s">${esc(s?.name || "Ohne Fach")} · ${arr(d.cards).length} Karten · ${fmtDate(d.createdAt)}</span></span>${due ? `<span class="pill due num">${due} fällig</span>` : ""}</button>`;
}
function vFaecher(){
  if (!S.ready) return vLoading();
  if (S.sel.doc && S.docs[S.sel.doc]) return vDoc(S.sel.doc);
  if (S.sel.subject && subj(S.sel.subject)) return vSubject(S.sel.subject);
  const subs = S.profile.subjects;
  return storeNotice() + `<div><p class="eyebrow">Semester</p><h1>Deine Fächer</h1></div>
    ${subs.length ? `<div class="list">${subs.map(s => {
      const docs = docsOf(s.id), cards = allCards((id,d) => d.subjectId === s.id), due = cards.filter(x => isDue(x.c)).length;
      return `<button class="item" data-act="openSubj" data-v="${esc(s.id)}">${subjDot(s)}<span class="grow"><span class="t">${esc(s.name)}</span><br><span class="s">${docs.length} ${docs.length===1?"Dokument":"Dokumente"} · ${cards.length} Karten${s.examDate && daysUntil(s.examDate)>=0 ? " · Prüfung in "+daysUntil(s.examDate)+" T" : ""}</span></span>${due ? `<span class="pill due num">${due} fällig</span>` : ""}</button>`;
    }).join("")}</div>` : `<div class="panel"><p>Noch keine Fächer. Lege eins an oder lade direkt ein Dokument hoch.</p></div>`}
    <form id="addSubjForm" class="panel stack"><label class="f" for="newSubjName">Neues Fach</label><div class="row" style="flex-wrap:nowrap"><input id="newSubjName" placeholder="z. B. Makroökonomie" maxlength="60" autocomplete="off"><button class="primary" type="submit">Anlegen</button></div></form>`;
}
function vSubject(sid){
  const s = subj(sid), docs = docsOf(sid), cards = allCards((id,d) => d.subjectId === sid), due = cards.filter(x => isDue(x.c)).length;
  const conf = S.confirm === "subj:"+sid;
  const left = s.examDate ? daysUntil(s.examDate) : -1;
  return `<button class="ghost back" data-act="back">← Alle Fächer</button>
    <div class="row" style="flex-wrap:nowrap">${subjDot(s)}<h1 style="min-width:0;overflow-wrap:anywhere">${esc(s.name)}</h1></div>
    <div class="row"><button class="primary" data-act="review" data-v="s:${esc(sid)}" ${due?"":"disabled"}>${due} fällige lernen</button><button data-act="reviewAll" data-v="s:${esc(sid)}" ${cards.length?"":"disabled"}>Alle üben</button><button data-act="examFrom" data-v="s:${esc(sid)}" ${docs.length?"":"disabled"}>Übungsklausur</button></div>
    <div class="panel stack"><label class="f" for="examDate">Prüfungstermin</label><input type="date" id="examDate" data-sid="${esc(sid)}" value="${esc(s.examDate||"")}">
      <p class="muted small">${left >= 0 ? "Noch "+left+" Tage. Bei "+cards.length+" Karten reichen etwa "+Math.max(1, Math.ceil((cards.length - cards.filter(x=>(x.c.box||0)>=4).length) * 3 / Math.max(1, left)))+" Wiederholungen pro Tag." : "Trag den Termin ein, dann zählt die Startseite herunter."}</p></div>
    <section class="stack"><div class="row between"><h2>Dokumente</h2><button class="ghost" data-act="uploadTo" data-v="${esc(sid)}">+ Hochladen</button></div>
    ${docs.length ? `<div class="list">${docs.map(([id,d]) => docItem(id,d)).join("")}</div>` : '<div class="panel"><p class="muted">Noch keine Dokumente in diesem Fach.</p></div>'}</section>
    <div class="row">${conf ? `<span>Fach mit ${docs.length} Dokumenten löschen?</span><button class="danger" data-act="delSubj" data-v="${esc(sid)}">Ja, löschen</button><button data-act="cancel">Abbrechen</button>` : `<button class="danger" data-act="confirm" data-v="subj:${esc(sid)}">Fach löschen</button>`}</div>`;
}
function vDoc(id){
  const d = S.docs[id], s = subj(d.subjectId), cards = arr(d.cards), due = cards.filter(isDue).length;
  const conf = S.confirm === "doc:"+id;
  return `<button class="ghost back" data-act="openSubj" data-v="${esc(d.subjectId)}">← ${esc(s?.name || "Fach")}</button>
    <div class="stack" style="gap:6px"><p class="eyebrow">${esc(d.fileName)} · ${fmtDate(d.createdAt)}</p><h1>${esc(d.title)}</h1></div>
    <div class="row"><button class="primary" data-act="review" data-v="d:${esc(id)}" ${due?"":"disabled"}>${due} fällige lernen</button><button data-act="reviewAll" data-v="d:${esc(id)}">Alle ${cards.length} üben</button><button data-act="examFrom" data-v="d:${esc(id)}">Übungsklausur</button></div>
    ${arr(d.summary).length ? `<section class="paper hero"><div class="row" style="height:20px"><span class="eyebrow">Zusammenfassung</span></div><ul class="sum" style="margin-top:14px">${d.summary.map(x => `<li>${esc(x)}</li>`).join("")}</ul>${arr(d.topics).length ? `<div class="tags">${d.topics.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}</section>` : ""}
    ${arr(d.videos).length ? `<section class="stack"><h2>Erklärvideos</h2><p class="muted small">Öffnet eine YouTube-Suche mit dem passenden Suchbegriff.</p><div class="list">${d.videos.map(v => `<a class="vid" href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.query)}" target="_blank" rel="noopener"><span class="play" aria-hidden="true"></span><span style="min-width:0"><b>${esc(v.title)}</b><br><span class="muted small">${esc(v.why)}</span><br><span class="eyebrow" style="text-transform:none;letter-spacing:0">„${esc(v.query)}“</span></span></a>`).join("")}</div></section>` : ""}
    <section class="stack"><div class="row between"><h2>Karteikarten <span class="muted num" style="font-weight:400">${cards.length}</span></h2>${d.text ? `<button class="ghost" data-act="more" data-v="${esc(id)}" ${S.moreBusy?"disabled":""}>${S.moreBusy===id ? '<span class="spinner"></span> Erstelle…' : "+ 10 weitere erstellen"}</button>` : ""}</div>
    <div class="list">${cards.map(c => `<div class="cardrow"><span class="q">${esc(c.q)}</span><span>${lvl(c.box)}</span><span class="a">${esc(c.a)}</span><button class="ghost" style="min-height:32px;padding:2px 8px;color:var(--muted)" data-act="delCard" data-v="${esc(id)}|${esc(c.id)}" aria-label="Karte löschen">×</button></div>`).join("")}</div>
    <form id="addCardForm" data-doc="${esc(id)}" class="panel stack"><h3>Eigene Karte hinzufügen</h3><label class="f" for="ncQ">Frage<input id="ncQ" required maxlength="500"></label><label class="f" for="ncA">Antwort<textarea id="ncA" required maxlength="1500" style="min-height:80px"></textarea></label><button type="submit">Karte hinzufügen</button></form></section>
    <div class="row">${conf ? `<span>Dokument und alle Karten löschen?</span><button class="danger" data-act="delDoc" data-v="${esc(id)}">Ja, löschen</button><button data-act="cancel">Abbrechen</button>` : `<button class="danger" data-act="confirm" data-v="doc:${esc(id)}">Dokument löschen</button>`}</div>`;
}
function vUpload(){
  const U = S.upload, subs = S.profile.subjects;
  const sel = U.subjectId || subs[0]?.id || "__new";
  const showNew = !subs.length || sel === "__new";
  if (U.busy) return `<div><p class="eyebrow">Neues Material</p><h1>Karteikarten entstehen</h1></div>
    <div class="paper hero"><div class="row" style="height:20px"><span class="eyebrow">${esc(U.files[0]?.name || "Eingefügter Text")}</span></div>
    <div class="row" style="margin-top:14px;flex-wrap:nowrap"><span class="spinner"></span><span id="genStage">${esc(U.stage)}</span></div>
    <p class="muted">Bei langen Skripten kann das ein bis zwei Minuten dauern.</p><button data-act="genStop">Abbrechen</button></div>`;
  return `<div><p class="eyebrow">Neues Material</p><h1>Dokument hochladen</h1></div>
    ${keyNotice()}
    ${U.error ? `<div class="notice bad" role="alert">${esc(U.error)}</div>` : ""}
    <label class="drop" id="drop" for="fileIn">
      <input type="file" id="fileIn" multiple accept=".pdf,.docx,.txt,.md,.tex,image/*">
      <h3>${U.files.length ? esc(U.files.map(f => f.name).join(", ")) : "Datei auswählen"}</h3>
      <span class="muted small">${U.files.length ? "Tippen, um andere Dateien zu wählen" : "PDF, Word, Text oder Fotos deiner Mitschrift"}</span>
    </label>
    <label class="f" for="pasteIn">Oder Text einfügen<textarea id="pasteIn" placeholder="Vorlesungsnotizen, Abschnitt aus dem Skript…">${esc(U.text)}</textarea></label>
    <label class="f" for="subjSel">Fach<select id="subjSel">${subs.map(s => `<option value="${esc(s.id)}" ${s.id===sel?"selected":""}>${esc(s.name)}</option>`).join("")}<option value="__new" ${showNew?"selected":""}>+ Neues Fach…</option></select></label>
    ${showNew ? `<label class="f" for="newSubjIn">Name des neuen Fachs<input id="newSubjIn" value="${esc(U.newSubject)}" placeholder="z. B. Organische Chemie" maxlength="60"></label>` : ""}
    <button class="primary block" data-act="gen">Karteikarten erstellen</button>
    <p class="muted small">Du bekommst Karteikarten, eine Zusammenfassung und Videovorschläge. Folien aus PowerPoint bitte vorher als PDF exportieren.</p>`;
}
function vReview(){
  const R = S.review, cur = curCard();
  if (!R) { S.view = "heute"; return vHeute(); }
  if (!cur) {
    return `<div><p class="eyebrow">Geschafft</p><h1>${R.done} ${R.done===1?"Karte":"Karten"} wiederholt</h1></div>
      <div class="statrow"><div class="stat"><b>${R.counts[0]}</b><span>Nochmal</span></div><div class="stat"><b>${R.counts[1]+R.counts[2]}</b><span>Gewusst</span></div><div class="stat"><b>${R.counts[3]}</b><span>Leicht</span></div></div>
      <div class="row"><button class="primary" data-act="endReview">Zur Übersicht</button>${allCards(scopeFilter(R.scope)).filter(x=>isDue(x.c)).length ? `<button data-act="review" data-v="${esc(R.scope)}">Weitere fällige</button>` : ""}</div>`;
  }
  const {d, c} = cur, s = subj(d.subjectId);
  const pct = Math.round(R.done / R.total * 100);
  const lbl = ["Nochmal","Schwer","Gut","Leicht"];
  return `<div class="row between"><button class="ghost back" data-act="endReview">← Beenden</button><span class="eyebrow num">${R.done} / ${R.total}</span></div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="review">
      <button class="paper fc" data-act="reveal" aria-live="polite">
        <span class="head"><span class="row" style="gap:8px;min-width:0;flex-wrap:nowrap">${subjDot(s)}<span class="eyebrow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.title)}</span></span>${lvl(c.box)}</span>
        <span class="qtext">${esc(c.q)}</span>
        ${R.shown ? `<span class="atext">${esc(c.a)}</span>` : `<span class="hint">Überleg dir die Antwort, dann tippe auf die Karte.</span>`}
      </button>
      ${R.shown ? `<div class="grades">${[0,1,2,3].map(g => `<button class="g${g}" data-act="grade" data-v="${g}">${lbl[g]}<small>${g===0 ? "gleich" : fmtDays(INTERVALS[nextBox(c,g)])}</small></button>`).join("")}</div>` : `<button class="primary block" data-act="reveal">Antwort zeigen</button>`}
    </div>`;
}
function scopeOptions(sel){
  let h = `<option value="all" ${sel==="all"?"selected":""}>Alle Fächer</option>`;
  for (const s of S.profile.subjects) {
    const docs = docsOf(s.id); if (!docs.length) continue;
    h += `<optgroup label="${esc(s.name)}"><option value="s:${esc(s.id)}" ${sel==="s:"+s.id?"selected":""}>Ganzes Fach: ${esc(s.name)}</option>${docs.map(([id,d]) => `<option value="d:${esc(id)}" ${sel==="d:"+id?"selected":""}>${esc(d.title)}</option>`).join("")}</optgroup>`;
  }
  return h;
}
function vKlausur(){
  if (!S.ready) return vLoading();
  const E = S.exam || (S.exam = {stage:"setup", scope:"all", n:8});
  if (!Object.keys(S.docs).length) return `<div><p class="eyebrow">Prüfungsvorbereitung</p><h1>Übungsklausur</h1></div><div class="panel stack"><p>Sobald du Dokumente hochgeladen hast, erstellt Claude daraus Klausuren mit Multiple-Choice- und offenen Aufgaben und korrigiert deine Antworten.</p><button class="primary" data-act="nav" data-v="upload">Dokument hochladen</button></div>`;
  if (E.stage === "setup") return `<div><p class="eyebrow">Prüfungsvorbereitung</p><h1>Übungsklausur</h1></div>
    ${keyNotice()}
    ${E.error ? `<div class="notice bad" role="alert">${esc(E.error)}</div>` : ""}
    <div class="panel stack">
      <label class="f" for="exScope">Stoff<select id="exScope">${scopeOptions(E.scope)}</select></label>
      <label class="f" for="exN">Anzahl Aufgaben<select id="exN">${[5,8,12,16].map(n => `<option ${n===E.n?"selected":""}>${n}</option>`).join("")}</select></label>
      <button class="primary" data-act="examStart">Klausur erstellen</button>
      <p class="muted small">Etwa 60 % Multiple Choice, 40 % offene Aufgaben. Offene Antworten bewertet Claude mit Punkten und Feedback.</p>
    </div>
    ${arr(S.profile.exams).length ? `<section class="stack"><h2>Letzte Ergebnisse</h2><div class="list">${S.profile.exams.slice(0,6).map(x => `<div class="item"><span class="grow"><span class="t">${esc(x.label)}</span><br><span class="s">${fmtDate(x.date)}</span></span><span class="pill num">${x.pct} %</span></div>`).join("")}</div></section>` : ""}`;
  if (E.stage === "loading" || E.stage === "grading") return `<div><p class="eyebrow">${esc(scopeLabel(E.scope))}</p><h1>${E.stage === "loading" ? "Klausur wird erstellt" : "Antworten werden korrigiert"}</h1></div>
    <div class="paper hero"><div class="row" style="height:20px"><span class="eyebrow">Bitte warten</span></div><div class="row" style="margin-top:14px;flex-wrap:nowrap"><span class="spinner"></span><span>${E.stage === "loading" ? "Claude stellt "+E.n+" Aufgaben aus deinem Material zusammen…" : "Claude vergleicht deine Antworten mit den Musterlösungen…"}</span></div><button data-act="examStop">Abbrechen</button></div>`;
  const done = E.stage === "done";
  const max = E.questions.reduce((s,q) => s+q.points, 0);
  return `<div class="row between"><button class="ghost back" data-act="examNew">← Neue Klausur</button><span class="eyebrow">${esc(scopeLabel(E.scope))}</span></div>
    ${done ? `<div class="paper hero"><div class="row" style="height:20px"><span class="eyebrow">Ergebnis</span></div><div class="row between" style="align-items:flex-end;margin-top:14px"><div><div class="score num">${E.pct} %</div><p class="muted num">${E.results.reduce((s,r)=>s+r.score,0).toLocaleString("de-DE")} von ${max} Punkten</p></div><span class="pill ${E.pct>=50?"":"due"}">${E.pct>=85?"Sehr gut":E.pct>=65?"Gut":E.pct>=50?"Bestanden":"Noch üben"}</span></div></div>` : `<h1>${E.questions.length} Aufgaben</h1>`}
    <div class="list">${E.questions.map((q,i) => {
      const r = done ? E.results[i] : null;
      const head = `<div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><b style="min-width:0;overflow-wrap:anywhere">${i+1}. ${esc(q.q)}</b><span class="pill num">${done ? r.score.toLocaleString("de-DE")+"/" : ""}${q.points} P</span></div>`;
      if (q.type === "mc") return `<div class="q">${head}${q.options.map((o,j) => {
        const cls = done ? (j === q.correct ? "right" : E.answers[i] === j ? "wrong" : "") : "";
        return `<label class="opt ${cls}" for="q${i}o${j}"><input type="radio" name="q${i}" id="q${i}o${j}" value="${j}" ${E.answers[i]===j?"checked":""} ${done?"disabled":""}><span>${esc(o)}</span></label>`;
      }).join("")}${done && q.explain ? `<div class="fb">${esc(q.explain)}</div>` : ""}</div>`;
      return `<div class="q">${head}<textarea id="qa${i}" ${done?"disabled":""} placeholder="Deine Antwort…">${esc(E.answers[i]||"")}</textarea>${done ? `${r.feedback ? `<div class="fb">${esc(r.feedback)}</div>` : ""}<div class="fb"><span class="eyebrow">Musterlösung</span><br>${esc(q.model)}</div>` : ""}</div>`;
    }).join("")}</div>
    ${done ? `<div class="row"><button class="primary" data-act="examNew">Neue Klausur</button><button data-act="examRetry">Gleicher Stoff, neue Aufgaben</button></div>` : `<button class="primary block" data-act="examSubmit">Abgeben und korrigieren</button>`}`;
}
function vStats(){
  if (!S.ready) return vLoading();
  const st = stats(), log = S.profile.log || {};
  const days = []; const d = today(); d.setDate(d.getDate()-13);
  for (let i=0;i<14;i++){ days.push({k:dkey(d), wd:d.toLocaleDateString("de-DE",{weekday:"narrow"}), n:log[dkey(d)]?.n||0}); d.setDate(d.getDate()+1); }
  const max = Math.max(5, ...days.map(x => x.n));
  const total14 = days.reduce((s,x) => s+x.n, 0);
  const okAll = Object.values(log).reduce((s,x) => s+(x.ok||0), 0), nAll = Object.values(log).reduce((s,x) => s+(x.n||0), 0);
  const boxes = [0,0,0,0,0,0]; allCards().forEach(x => boxes[x.c.box||0]++);
  return `<div><p class="eyebrow">Fortschritt</p><h1>Statistik</h1></div>
    <div class="statrow">
      <div class="stat"><b>${st.streak}</b><span>Tage in Folge</span></div>
      <div class="stat"><b>${nAll ? Math.round(okAll/nAll*100) : 0} %</b><span>Trefferquote</span></div>
      <div class="stat"><b>${st.learned}</b><span>von ${st.total} begonnen</span></div>
    </div>
    <section class="panel stack"><div class="row between"><h3>Wiederholungen, 14 Tage</h3><span class="eyebrow num">${total14} gesamt</span></div>
      <div class="bars">${days.map((x,i) => `<div class="bar ${i===13?"today":""}" title="${x.k}: ${x.n}"><em>${x.n||""}</em><i style="height:${Math.round(x.n/max*100)}%"></i><span>${esc(x.wd)}</span></div>`).join("")}</div>
    </section>
    <section class="panel stack"><h3>Karten nach Stufe</h3><p class="muted small">Jede richtige Antwort schiebt eine Karte eine Stufe weiter. Ab Stufe 5 gilt sie als sicher gelernt.</p>
      ${boxes.map((n,i) => `<div class="stack" style="gap:4px"><div class="row between"><span>Stufe ${i+1} <span class="muted" style="font-size:13px">· Wiederholung ${i===0?"sofort":"nach "+fmtDays(INTERVALS[i])}</span></span><span class="num">${n}</span></div><div class="meter" style="--c:${i>=4?"var(--good)":"var(--accent)"}"><i style="width:${st.total ? n/st.total*100 : 0}%"></i></div></div>`).join("")}
    </section>
    ${S.profile.subjects.length ? `<section class="panel stack"><h3>Nach Fach</h3>${S.profile.subjects.map(s => {
      const cs = allCards((id,d) => d.subjectId === s.id), m = cs.filter(x => (x.c.box||0) >= 4).length;
      return `<div class="stack" style="gap:4px"><div class="row between" style="flex-wrap:nowrap"><span class="row" style="gap:8px;flex-wrap:nowrap;min-width:0">${subjDot(s)}<span style="overflow-wrap:anywhere">${esc(s.name)}</span></span><span class="num muted" style="white-space:nowrap">${m} / ${cs.length} sicher</span></div><div class="meter" style="--c:var(--s${s.color})"><i style="width:${cs.length ? m/cs.length*100 : 0}%"></i></div></div>`;
    }).join("")}</section>` : ""}
    ${arr(S.profile.exams).length ? `<section class="stack"><h2>Übungsklausuren</h2><div class="list">${S.profile.exams.slice(0,8).map(x => `<div class="item"><span class="grow"><span class="t">${esc(x.label)}</span><br><span class="s">${fmtDate(x.date)}</span></span><span class="pill num">${x.pct} %</span></div>`).join("")}</div></section>` : ""}`;
}
function vSettings(){
  const k = settings.key, conf = S.confirm === "wipe";
  return `<div><p class="eyebrow">App</p><h1>Einstellungen</h1></div>
    <form id="keyForm" class="panel stack">
      <h3>Anthropic-API-Schlüssel</h3>
      <p class="muted small">Die App schickt deine Dokumente direkt aus deinem Browser an Claude. Dafür brauchst du einen eigenen Schlüssel von <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener" style="color:var(--accent)">console.anthropic.com</a>. Die Abrechnung läuft über dein API-Konto, nicht über ein Claude-Abo.</p>
      <label class="f" for="keyIn">Schlüssel<div class="keyrow"><input id="keyIn" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(k)}"><button class="primary" type="submit">Speichern</button></div></label>
      <p class="small ${k ? "" : "muted"}">${k ? "Gespeichert: …" + esc(k.slice(-4)) + " · nur auf diesem Gerät" : "Noch kein Schlüssel hinterlegt."}</p>
      ${k ? '<button type="button" class="danger" data-act="clearKey">Schlüssel entfernen</button>' : ""}
    </form>
    <div class="panel stack">
      <label class="f" for="modelSel">Modell<select id="modelSel">${MODELS.map(m => `<option value="${m.id}" ${m.id===settings.model?"selected":""}>${esc(m.label)}</option>`).join("")}</select></label>
    </div>
    <div class="panel stack">
      <h3>Daten</h3>
      <p class="muted small">Deine Karten liegen nur in diesem Browser. Sichere sie regelmäßig, um sie auf ein anderes Gerät zu übertragen oder nicht zu verlieren.</p>
      <div class="row"><button data-act="export">Backup herunterladen</button><label class="btn" for="importIn">Backup einspielen<input type="file" id="importIn" accept="application/json,.json" hidden></label></div>
      <div class="row">${conf ? '<span>Wirklich alle Fächer und Karten löschen?</span><button class="danger" data-act="wipe">Ja, alles löschen</button><button data-act="cancel">Abbrechen</button>' : '<button class="danger" data-act="confirm" data-v="wipe">Alle Daten löschen</button>'}</div>
    </div>`;
}

/* ---------- Rendern ---------- */
const VIEWS = {heute:vHeute, faecher:vFaecher, upload:vUpload, review:vReview, klausur:vKlausur, stats:vStats, settings:vSettings};
function renderHeader(){
  const m = {loading:["Lädt…",""], local:["Auf diesem Gerät","good"], memory:["Nicht gespeichert","warn"]}[S.store];
  const el = $("#status"); el.textContent = m[0]; el.className = "chip " + m[1];
  const tab = S.view === "review" ? "heute" : S.view;
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === tab));
}
function renderMain(){ $("#main").innerHTML = VIEWS[S.view](); }
function render(){ renderHeader(); renderMain(); }
function renderStage(){ const el = $("#genStage"); if (el) el.textContent = S.upload.stage; }

/* ---------- Ereignisse ---------- */
const ACT = {
  nav(v){ if (S.view === v && v === "faecher") S.sel = {subject:null, doc:null}; S.view = v; S.confirm = null; render(); scrollTo(0,0); },
  openSubj(v){ S.view = "faecher"; S.sel = {subject:v, doc:null}; S.confirm = null; render(); scrollTo(0,0); },
  openDoc(v){ S.view = "faecher"; S.sel = {subject:S.docs[v]?.subjectId, doc:v}; S.confirm = null; render(); scrollTo(0,0); },
  back(){ S.sel = {subject:null, doc:null}; S.confirm = null; render(); },
  uploadTo(v){ S.upload.subjectId = v; S.view = "upload"; render(); scrollTo(0,0); },
  example: loadExample,
  review(v){ startReview(v, false); },
  reviewAll(v){ startReview(v, true); },
  reveal(){ if (S.review && !S.review.shown) { S.review.shown = true; renderMain(); } },
  grade(v){ grade(Number(v)); },
  endReview(){ S.review = null; S.view = "heute"; render(); },
  confirm(v){ S.confirm = v; renderMain(); },
  cancel(){ S.confirm = null; renderMain(); },
  delDoc(id){ delete S.docs[id]; remove(id); S.sel.doc = null; S.confirm = null; toast("Dokument gelöscht"); render(); },
  delSubj(sid){
    for (const [id] of docsOf(sid)) { delete S.docs[id]; remove(id); }
    S.profile.subjects = S.profile.subjects.filter(s => s.id !== sid); saveProfile();
    S.sel = {subject:null, doc:null}; S.confirm = null; toast("Fach gelöscht"); render();
  },
  delCard(v){ const [id, cid] = v.split("|"); const d = S.docs[id]; if (!d) return; d.cards = arr(d.cards).filter(c => c.id !== cid); save(id, d); renderMain(); },
  more(v){ moreCards(v); },
  gen: genStart,
  genStop(){ S.upload.ctl?.abort(); },
  examFrom(v){ S.exam = {stage:"setup", scope:v, n:8}; S.view = "klausur"; render(); scrollTo(0,0); },
  examStart, examSubmit,
  examStop(){ S.exam?.ctl?.abort(); },
  examNew(){ S.exam = {stage:"setup", scope:S.exam?.scope || "all", n:S.exam?.n || 8}; renderMain(); scrollTo(0,0); },
  examRetry(){ S.exam = {stage:"setup", scope:S.exam.scope, n:S.exam.n}; examStart(); },
  clearKey(){ settings.key = ""; toast("Schlüssel entfernt"); renderMain(); },
  export: exportBackup,
  wipe: wipeAll
};
document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
  const f = ACT[t.dataset.act]; if (f) { e.preventDefault(); f(t.dataset.v, t); }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "addSubjForm") { const n = $("#newSubjName").value.trim(); if (!n) return; addSubject(n); toast("Fach angelegt"); renderMain(); }
  if (e.target.id === "addCardForm") {
    const id = e.target.dataset.doc, d = S.docs[id], q = $("#ncQ").value.trim(), a = $("#ncA").value.trim();
    if (!d || !q || !a) return; d.cards = [...arr(d.cards), newCard(q, a)]; save(id, d); toast("Karte hinzugefügt"); renderMain();
  }
  if (e.target.id === "keyForm") {
    const v = $("#keyIn").value.trim();
    if (v && !v.startsWith("sk-ant-")) { toast("Das sieht nicht wie ein Anthropic-Schlüssel aus (sk-ant-…)."); return; }
    settings.key = v; toast(v ? "Schlüssel gespeichert" : "Schlüssel entfernt"); renderMain();
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "fileIn") { S.upload.files = [...t.files]; S.upload.error = ""; renderMain(); }
  else if (t.id === "importIn" && t.files[0]) importBackup(t.files[0]);
  else if (t.id === "modelSel") { settings.model = t.value; toast("Modell gespeichert"); }
  else if (t.id === "subjSel") { S.upload.subjectId = t.value; renderMain(); }
  else if (t.id === "examDate") { const s = subj(t.dataset.sid); if (s) { s.examDate = t.value; saveProfile(); renderMain(); } }
  else if (t.id === "exScope") S.exam.scope = t.value;
  else if (t.id === "exN") S.exam.n = Number(t.value);
  else if (t.name && /^q\d+$/.test(t.name) && S.exam) S.exam.answers[Number(t.name.slice(1))] = Number(t.value);
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "pasteIn") S.upload.text = t.value;
  else if (t.id === "newSubjIn") S.upload.newSubject = t.value;
  else if (/^qa\d+$/.test(t.id) && S.exam) S.exam.answers[Number(t.id.slice(2))] = t.value;
});
document.addEventListener("dragover", e => { const d = e.target.closest && e.target.closest("#drop"); if (d) { e.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", e => { const d = e.target.closest && e.target.closest("#drop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", e => { const d = e.target.closest && e.target.closest("#drop"); if (d) { e.preventDefault(); S.upload.files = [...e.dataTransfer.files]; S.upload.error = ""; renderMain(); } });
document.addEventListener("keydown", e => {
  if (S.view !== "review" || !S.review || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if ((e.key === " " || e.key === "Enter") && !S.review.shown) { e.preventDefault(); ACT.reveal(); }
  else if (S.review.shown && ["1","2","3","4"].includes(e.key)) grade(Number(e.key)-1);
});

/* ---------- Start ---------- */
(async () => {
  render();
  try {
    idb = await openDb();
    await loadAll();
    S.store = "local";
    navigator.storage?.persist?.().catch(() => {});
  } catch {
    idb = null; S.store = "memory";
  }
  S.ready = true;
  render();
})();
