"use strict";
/* Funktionen: Daten-Helfer, Lernplan, Upload & Generierung, Abfrage, Klausur, Erklär-Chat,
   Glossar, Mindmap, Lernzettel, Schwächen, Videos, Teilen, Quiz-Duell, Backup, Erinnerung */

/* ---------- Daten-Helfer ---------- */
const subj = id => S.profile.subjects.find(s => s.id === id);
const docsOf = sid => Object.entries(S.docs).filter(([,d]) => d.subjectId === sid).sort((a,b) => b[1].createdAt - a[1].createdAt);
function allCards(filter){
  const out = [];
  for (const [id, d] of Object.entries(S.docs)) { if (filter && !filter(id, d)) continue; for (const c of arr(d.cards)) out.push({docId:id, c}); }
  return out;
}
const scopeFilter = scope => !scope || scope === "all" ? null : scope.startsWith("d:") ? (id => id === scope.slice(2)) : ((id, d) => d.subjectId === scope.slice(2));
const newCard = (q, a, kind = "basic") => ({id:rid("c"), kind:kind === "cloze" ? "cloze" : "basic", q:String(q).trim(), a:String(a || "").trim(), reps:0, lapses:0, u:Date.now()});
/* Gleicher Text für alle Anfragen zu einem Dokument, damit der Prompt-Cache greift */
const docContext = d => `Dokument: ${d.title}\n\n` + (d.text ? d.text.slice(0, CHUNK_CHARS) : arr(d.cards).map(c => `F: ${c.q}\nA: ${c.a}`).join("\n"));
function editCard(docId, cardId, {kind, q, a}){
  const d = S.docs[docId], c = d && arr(d.cards).find(x => x.id === cardId); if (!c) return false;
  Object.assign(c, {kind:kind === "cloze" ? "cloze" : "basic", q:String(q).trim(), a:String(a || "").trim(), u:Date.now()});
  save(docId, d); return true;
}
function deleteCard(docId, cardId){
  const d = S.docs[docId]; if (!d) return;
  d.cards = arr(d.cards).filter(c => c.id !== cardId); addTomb(d.delCards || (d.delCards = {}), cardId); save(docId, d);
}
function searchCards(q){
  const words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length || words.join("").length < 2) return [];
  return allCards().filter(x => { const t = (x.c.q + " " + x.c.a).toLowerCase(); return words.every(w => t.includes(w)); }).slice(0, 50);
}
async function imgBlob(key){
  const b = idb ? await tx("img","readonly", st => st.get(key)).catch(() => null) : null;
  return b || await Img.fetch(key);
}
const promptById = id => S.profile.prompts.find(p => p.id === id) || S.profile.prompts[0];
const examActive = s => !!(s && s.examDate && daysUntil(s.examDate) >= 0);
function addSubject(name){
  const s = {id:rid("s"), name:name.trim().slice(0,60), color:S.profile.subjects.length % SUBJ_COLORS, examDate:""};
  S.profile.subjects.push(s); saveProfile(); return s.id;
}
function scopeLabel(sc){
  if (!sc || sc === "all") return "Alle Fächer";
  if (sc.startsWith("s:")) return subj(sc.slice(2))?.name || "Fach";
  return S.docs[sc.slice(2)]?.title || "Dokument";
}
function cardsFromAI(list){
  return arr(list).filter(c => c && c.q && (c.a || c.type === "cloze")).map(c => {
    const kind = c.type === "cloze" && /\{\{.+?\}\}/.test(c.q) ? "cloze" : "basic";
    const card = newCard(c.q, c.a, kind);
    if (Number.isInteger(c.page)) card.page = c.page;
    return card;
  });
}
function material(scope, docIds){
  const f = scopeFilter(scope);
  const ids = docIds || Object.keys(S.docs).filter(id => !f || f(id, S.docs[id]));
  const per = Math.floor(60000 / Math.max(ids.length, 1));
  let m = "";
  for (const id of ids) {
    const d = S.docs[id]; if (!d) continue;
    const sum = d.summaries.find(x => x.id === d.activeSummary) || d.summaries[0];
    m += `\n## ${d.title}\n${sum ? "Zusammenfassung:\n" + sum.md + "\n" : ""}Karteikarten:\n` + arr(d.cards).map(c => `F: ${c.q}\nA: ${c.a}`).join("\n") + (d.text ? "\nAuszug aus dem Original:\n" + d.text.slice(0, per) : "") + "\n";
  }
  return m.slice(0, 150000);
}

/* ---------- Statistik & Lernplan ---------- */
function stats(){
  const cards = allCards(), log = S.profile.log || {};
  let streak = 0; const d = today();
  if (!(log[dkey(d)]?.n)) d.setDate(d.getDate()-1);
  while (log[dkey(d)]?.n) { streak++; d.setDate(d.getDate()-1); }
  return {
    total:cards.length, due:cards.filter(x => isDue(x.c)).length, fresh:cards.filter(x => isNew(x.c)).length,
    mastered:cards.filter(x => isMastered(x.c)).length, learned:cards.filter(x => x.c.reps).length,
    weak:cards.filter(x => isWeak(x.c)).length, streak, todayN:log[dkey()]?.n || 0
  };
}
function newCardsOf(sid){
  const out = [];
  for (const [id, d] of docsOf(sid).reverse()) for (const c of arr(d.cards)) if (isNew(c)) out.push({docId:id, c});
  return out;
}
function planToday(){
  const lg = S.profile.log[dkey()] || {}, intro = lg.newBy || {};
  let free = Math.max(0, (S.profile.prefs.newPerDay || 20) - Object.entries(intro).filter(([sid]) => !examActive(subj(sid))).reduce((a, [, n]) => a + n, 0));
  return S.profile.subjects.map(s => {
    const fresh = newCardsOf(s.id), due = allCards((id, d) => d.subjectId === s.id).filter(x => isDue(x.c)).length;
    let quota, perDay = null, left = null;
    if (examActive(s)) {
      left = daysUntil(s.examDate);
      perDay = Math.ceil((fresh.length + (intro[s.id] || 0)) / Math.max(1, left - 2));
      quota = clamp(perDay - (intro[s.id] || 0), 0, fresh.length);
    } else { quota = Math.min(fresh.length, free); free -= quota; }
    return {s, due, quota, fresh:fresh.length, perDay, left, introduced:intro[s.id] || 0};
  });
}
function planTotals(){
  const p = planToday();
  return {due:p.reduce((a, x) => a + x.due, 0), fresh:p.reduce((a, x) => a + x.quota, 0), plan:p};
}
function updateBadge(){
  try { const n = planTotals(); const t = n.due + n.fresh; if (navigator.setAppBadge) t ? navigator.setAppBadge(t) : navigator.clearAppBadge(); } catch {}
}

/* ---------- Dokumente lesen ---------- */
async function renderPdfPage(pdf, p){
  const page = await pdf.getPage(p);
  const vp0 = page.getViewport({scale:1}), scale = Math.min(2, 1200 / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({scale});
  const cv = document.createElement("canvas"); cv.width = vp.width; cv.height = vp.height;
  await page.render({canvasContext:cv.getContext("2d"), viewport:vp}).promise;
  return await new Promise(r => cv.toBlob(r, "image/jpeg", .82));
}
/* Text in Teile zerlegen, bevorzugt an Seitenmarken, dann an Absätzen. Zusammengesetzt ergibt sich wieder der Originaltext. */
function splitText(text, max){
  if (text.length <= max) return [text];
  const out = []; let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n[Seite ", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/* PowerPoint (.pptx): Folientext, Sprechernotizen und das größte Bild jeder Folie */
const XML_ENT = {lt:"<", gt:">", amp:"&", quot:'"', apos:"'"};
const decodeXml = s => s.replace(/&(lt|gt|amp|quot|apos|#x[0-9a-f]+|#\d+);/gi, (m, e) => XML_ENT[e.toLowerCase()] ?? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const pptxText = xml => xml.split(/<\/a:p>/).map(p => [...p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map(m => decodeXml(m[1])).join("").trim()).filter(Boolean).join("\n");
const slideNo = p => Number(p.match(/(\d+)\.xml$/)[1]);
const relTargets = (xml, kind) => [...xml.matchAll(/<Relationship\b[^>]*>/g)].map(m => m[0]).filter(r => new RegExp('Type="[^"]*/' + kind + '"').test(r)).map(r => r.match(/Target="([^"]+)"/)?.[1]).filter(Boolean);
function resolvePath(base, target){
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/"); parts.pop();
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
}
async function extractPptx(f, offset){
  if (!window.JSZip) throw {code:"local", message:"Der PowerPoint-Leser konnte nicht geladen werden. Lade die Seite neu oder exportiere als PDF."};
  let zip;
  try { zip = await JSZip.loadAsync(await f.arrayBuffer()); } catch { throw {code:"local", message:"Diese PowerPoint-Datei konnte nicht geöffnet werden. Exportiere sie als PDF."}; }
  const slides = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNo(a) - slideNo(b));
  if (!slides.length) throw {code:"local", message:"In dieser PowerPoint-Datei wurden keine Folien gefunden."};
  let text = ""; const imgs = {};
  for (let i = 0; i < slides.length; i++) {
    const p = slides[i], page = offset + i + 1;
    text += `\n[Seite ${page}]\n` + pptxText(await zip.file(p).async("string"));
    const relF = zip.file(p.replace("slides/", "slides/_rels/") + ".rels"); if (!relF) continue;
    const rels = await relF.async("string");
    const note = relTargets(rels, "notesSlide")[0], nf = note && zip.file(resolvePath(p, note));
    if (nf) { const nt = pptxText(await nf.async("string")).split("\n").filter(l => !/^\d+$/.test(l)).join("\n"); if (nt) text += "\nNotizen: " + nt; }
    const media = relTargets(rels, "image").map(t => resolvePath(p, t)).filter(m => /\.(png|jpe?g|gif|webp|bmp)$/i.test(m) && zip.file(m));
    if (media.length) imgs[page] = {zip, path:media.sort((a, b) => (zip.file(b)._data?.uncompressedSize || 0) - (zip.file(a)._data?.uncompressedSize || 0))[0]};
  }
  return {text, pages:slides.length, slides:imgs};
}
async function slideImage(pm){
  const ext = pm.path.split(".").pop().toLowerCase();
  const raw = await pm.zip.file(pm.path).async("arraybuffer");
  return await shrinkImage(new Blob([raw], {type:"image/" + (ext === "jpg" ? "jpeg" : ext)}));
}

const TEXT_LIMIT = CHUNK_CHARS * MAX_CHUNKS;
async function extractFile(f, pageOffset){
  const name = f.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    if (!window.pdfjsLib) throw {code:"local", message:"Der PDF-Leser konnte nicht geladen werden. Lade die Seite neu."};
    const pdf = await pdfjsLib.getDocument({data:(await f.arrayBuffer()).slice(0)}).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages && text.length <= TEXT_LIMIT; i++) {
      const tc = await (await pdf.getPage(i)).getTextContent();
      text += "\n[Seite " + (pageOffset + i) + "]\n" + tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("");
    }
    const letters = text.replace(/\[Seite \d+\]|\s/g, "").length;
    if (letters < 60 * Math.min(pdf.numPages, 5)) {
      if (f.size > 30e6 || pdf.numPages > 100) throw {code:"local", message:"Dieses gescannte PDF ist zu groß. Teile es in kleinere Dateien (max. 100 Seiten)."};
      return {text:"", pdf, pages:pdf.numPages, scanned: await blobToB64(f)};
    }
    return {text, pdf, pages:pdf.numPages};
  }
  if (name.endsWith(".pptx")) return extractPptx(f, pageOffset);
  if (name.endsWith(".docx")) {
    if (!window.mammoth) throw {code:"local", message:"Der Word-Leser konnte nicht geladen werden. Exportiere die Datei als PDF."};
    return {text:(await mammoth.extractRawText({arrayBuffer:await f.arrayBuffer()})).value, pages:0};
  }
  if (/\.(txt|md|csv|tex|rtf)$/.test(name)) return {text:await f.text(), pages:0};
  if (/\.(ppt|key)$/.test(name)) throw {code:"local", message:"Alte PowerPoint-Dateien (.ppt) und Keynote bitte als .pptx oder PDF speichern und dann hochladen."};
  throw {code:"local", message:"Dieses Format kann die App nicht lesen: " + f.name + ". Nimm PDF, PowerPoint (.pptx), Word, Text oder Fotos."};
}

/* ---------- Prompts ---------- */
const CARD_RULES = `Karteikarten:
- 12 bis 30 Karten, je nach Umfang. Etwa 70 % "basic" (Frage/Antwort) und 30 % "cloze" (Lückentext, Lücken in doppelten geschweiften Klammern).
- Pro Karte genau ein Gedanke. Antworten knapp: höchstens 2-3 Sätze oder eine Formel mit kurzer Erklärung.
- Formeln immer in LaTeX zwischen $...$ (z. B. $E = mc^2$).
- Decke Definitionen, Zusammenhänge, Formeln, Abläufe und Beispiele ab. Frage nach Verständnis, nicht nur nach Wortlaut.
- "page" nur angeben, wenn eine Abbildung, Grafik oder Tabelle auf dieser Seite für die Karte wichtig ist (Seitennummer aus den Markierungen [Seite N]). Sonst weglassen.
- Keine Karten zu Organisatorischem (Termine, Folienzahlen, Literaturlisten).`;
const CARD_JSON = `[{"type":"basic","q":"Frage","a":"Antwort","page":3},{"type":"cloze","q":"Satz mit {{Lücke}} und noch einer {{Lücke}}","a":"optionale Zusatzinfo"}]`;
const summaryRules = mp => `Zusammenfassung (Markdown mit ## Überschriften, Stichpunkten, **fett**, Formeln in $...$). Befolge dafür diese Anweisungen (Masterprompt „${mp.name}“):
"""
${mp.text}
"""`;
function genPrompt(subject, fileName, text, notes, mp, parts = 1){
  return `Du bist ein Lerncoach für Studierende. Erstelle aus dem folgenden Uni-Material Lernmaterial. Schreibe in der Sprache des Materials (meist Deutsch).
${parts > 1 ? `\nDas Material ist lang und wird in ${parts} Teilen verarbeitet. Dies ist Teil 1: Erstelle Karten und Zusammenfassung nur für diesen Teil, Titel und Videos für das ganze Thema.\n` : ""}
Antworte NUR mit einem JSON-Objekt in genau dieser Form:
{"title":"kurzer, sprechender Titel (max. 8 Wörter)","summary":"Zusammenfassung als Markdown","topics":["3 bis 6 Schlagworte"],"cards":${CARD_JSON},"videos":[{"title":"Wonach suchen","query":"präziser YouTube-Suchbegriff","why":"Warum das hilft (1 Satz)"}]}

${CARD_RULES}
Videos: 3 bis 5 Vorschläge mit Suchbegriffen, die bei YouTube gute Erklärvideos zu den Kernthemen finden.

${summaryRules(mp)}

Fach: ${subject}
Datei: ${fileName}
${notes}
MATERIAL:
"""
${text || "(siehe Anhänge)"}
"""`;
}
function partPrompt(subject, fileName, text, i, n, mp){
  return `Du bist ein Lerncoach für Studierende. Dies ist Teil ${i + 1} von ${n} eines langen Uni-Dokuments. Erstelle Lernmaterial NUR für diesen Teil. Schreibe in der Sprache des Materials (meist Deutsch).

Antworte NUR mit einem JSON-Objekt in genau dieser Form:
{"summary":"Zusammenfassung dieses Teils als Markdown","topics":["2 bis 4 Schlagworte"],"cards":${CARD_JSON}}

${CARD_RULES}

${summaryRules(mp)}

Fach: ${subject}
Datei: ${fileName}
MATERIAL (Teil ${i + 1} von ${n}):
"""
${text}
"""`;
}

/* ---------- Upload & Generierung ---------- */
async function genStart(){
  const U = S.upload; U.error = "";
  if (!aiReady()) { U.error = errText({code:"no_key"}); return renderMain(); }
  let sid = U.subjectId || (S.profile.subjects[0]?.id ?? "");
  if (sid === "__new" || !S.profile.subjects.length) {
    const n = (U.newSubject || "").trim();
    if (!n) { U.error = "Gib dem neuen Fach einen Namen."; return renderMain(); }
    sid = addSubject(n);
  }
  if (!U.files.length && !U.text.trim()) { U.error = "Wähle eine Datei oder füge Text ein."; return renderMain(); }
  const mp = promptById(U.promptId || S.profile.activePromptId);
  U.subjectId = sid; U.busy = true; U.stage = "Dokument wird gelesen…"; renderMain();
  try {
    let text = U.text.trim(), offset = 0;
    const images = [], pdfs = [], pageMap = {}, notes = [], warnings = [];
    const name = U.files[0]?.name || "Eingefügter Text";
    const photos = U.files.filter(f => f.type.startsWith("image/"));
    if (photos.length > MAX_IMAGES) throw {code:"local", message:`Es gehen höchstens ${MAX_IMAGES} Fotos auf einmal. Du hast ${photos.length} gewählt. Lade sie in mehreren Durchgängen hoch.`};
    for (const f of U.files.filter(f => !f.type.startsWith("image/"))) {
      const r = await extractFile(f, offset);
      text += "\n\n" + (r.text || "");
      if (r.pdf) for (let i = 1; i <= r.pages; i++) pageMap[offset + i] = {pdf:r.pdf, p:i};
      if (r.slides) Object.assign(pageMap, r.slides);
      if (r.scanned) { pdfs.push(r.scanned); notes.push(`Der PDF-Anhang ${pdfs.length} (${f.name}) entspricht den Seiten ${offset+1} bis ${offset+r.pages}.`); }
      offset += r.pages;
    }
    if (photos.length) {
      for (let i = 0; i < photos.length; i++) { const b = await shrinkImage(photos[i]); images.push(b); pageMap[offset + i + 1] = {blob:b}; }
      notes.push(`Die ${photos.length} Fotos sind in dieser Reihenfolge die Seiten ${offset+1} bis ${offset+photos.length}.`);
      offset += photos.length;
    }
    text = text.trim();
    if (text.replace(/\s/g, "").length < 60 && !images.length && !pdfs.length) throw {code:"local", message:"In der Datei wurde kaum Text gefunden. Fotografiere die Seiten und lade die Bilder hoch."};
    if (text.length > TEXT_LIMIT) throw {code:"local", message:`Das Material ist zu lang (über ${TEXT_LIMIT.toLocaleString("de-DE")} Zeichen, etwa 200 Seiten Fließtext). Teile es in mehrere Dateien auf und lade sie nacheinander hoch.`};
    const parts = splitText(text, CHUNK_CHARS), sname = subj(sid)?.name || "";
    const tag = i => parts.length > 1 ? `Teil ${i + 1} von ${parts.length}: ` : "";
    const ctl = new AbortController(); U.ctl = ctl;
    const progress = i => n => { U.stage = tag(i) + "Karteikarten entstehen… " + n.toLocaleString("de-DE") + " Zeichen"; renderStage(); };
    const sumMd = s => typeof s === "string" ? s : arr(s).map(x => "- " + x).join("\n");
    U.stage = tag(0) + "Claude liest das Material und erstellt Karteikarten…"; renderStage();
    const out = await askJSON(genPrompt(sname, name, parts[0], notes.join("\n"), mp, parts.length), {images, pdfs, signal:ctl.signal, maxTokens:16000, onProgress:progress(0)});
    const cards = cardsFromAI(out?.cards), topics = arr(out?.topics).map(String), sums = [{i:0, md:sumMd(out?.summary)}];
    for (let i = 1; i < parts.length; i++) {
      U.stage = tag(i) + "Claude liest den nächsten Abschnitt…"; renderStage();
      try {
        const o = await askJSON(partPrompt(sname, name, parts[i], i, parts.length, mp), {signal:ctl.signal, maxTokens:16000, onProgress:progress(i)});
        cards.push(...cardsFromAI(o?.cards)); topics.push(...arr(o?.topics).map(String)); sums.push({i, md:sumMd(o?.summary)});
      } catch (e) {
        if (e?.code === "cancelled") throw e;
        warnings.push(`Teil ${i + 1} von ${parts.length} konnte nicht verarbeitet werden: ${errText(e)} Mit „+ 10 weitere“ kannst du Karten nachholen.`);
      }
    }
    if (!cards.length) throw {code:"local", message:"Claude hat keine Karten geliefert. Versuch es noch einmal oder mit weniger Material."};
    const id = rid("d");
    U.stage = "Abbildungen werden gespeichert…"; renderStage();
    const done = new Set();
    for (const c of cards) {
      if (c.page == null || !pageMap[c.page]) { delete c.page; continue; }
      const key = id + ":" + c.page;
      if (!done.has(key) && done.size < 30) {
        const pm = pageMap[c.page];
        try { const blob = pm.blob || (pm.pdf ? await renderPdfPage(pm.pdf, pm.p) : await slideImage(pm)); if (blob) { await saveImg(key, blob); done.add(key); } } catch {}
      }
      if (done.has(key)) c.img = key;
      delete c.page;
    }
    const summaryMd = parts.length > 1 ? sums.filter(s => s.md).map(s => `# Teil ${s.i + 1}\n\n${s.md}`).join("\n\n") : sums[0].md;
    const sumId = rid("m");
    const doc = {
      type:"doc", subjectId:sid, title:String(out.title || name).slice(0,140), fileName:name, createdAt:Date.now(),
      summaries: summaryMd ? [{id:sumId, promptId:mp.id, promptName:mp.name, md:summaryMd, createdAt:Date.now()}] : [], activeSummary:sumId,
      topics:[...new Set(topics)].slice(0,8),
      videos:arr(out.videos).filter(v => v && v.query).slice(0,6).map(v => ({title:String(v.title || v.query), query:String(v.query), why:String(v.why || "")})),
      cards, text:(text || summaryMd).slice(0, CHUNK_CHARS), parts:parts.length, warnings, delCards:{}
    };
    S.docs[id] = doc; save(id, doc);
    S.upload = freshUpload(sid);
    S.view = "faecher"; S.sel = {subject:sid, doc:id, sheet:null};
    toast(cards.length + " Karteikarten erstellt" + (parts.length > 1 ? ` aus ${parts.length} Teilen` : ""));
    render(); scrollTo(0,0);
  } catch (e) {
    U.busy = false; U.ctl = null; U.stage = "";
    if (!e || e.code !== "cancelled") U.error = errText(e);
    renderMain();
  }
}
async function moreCards(id){
  const d = S.docs[id]; if (!d) return;
  if (!aiReady()) return toast(errText({code:"no_key"}));
  S.busy.more = id; renderMain();
  try {
    const out = await askJSON(`Erstelle 10 weitere Karteikarten zum Lernmaterial oben. Sie dürfen sich NICHT mit den vorhandenen Karten überschneiden; gehe tiefer oder decke Lücken ab. Etwa 30 % Lückentexte. Formeln in $...$. Gleiche Sprache wie das Material.
Antworte NUR mit JSON: {"cards":[{"type":"basic","q":"Frage","a":"knappe Antwort"},{"type":"cloze","q":"Satz mit {{Lücke}}","a":""}]}

Vorhandene Fragen:
${arr(d.cards).map(c => "- " + c.q).join("\n")}`, {context:docContext(d), maxTokens:5000});
    const add = cardsFromAI(out?.cards).map(c => { delete c.page; return c; });
    const cur = S.docs[id]; if (cur) { cur.cards = [...arr(cur.cards), ...add]; save(id, cur); }
    toast(add.length + " neue Karten");
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.busy.more = null; renderMain();
}
async function resummarize(docId, promptId){
  const d = S.docs[docId]; if (!d) return;
  if (!aiReady()) return toast(errText({code:"no_key"}));
  const mp = promptById(promptId);
  const ctl = new AbortController();
  S.busy.sum = {docId, text:"", ctl}; renderMain();
  try {
    const mdText = await askText(`Erstelle eine Zusammenfassung des Lernmaterials oben als Markdown (## Überschriften, Stichpunkte, **fett**, Formeln in LaTeX zwischen $...$). Gleiche Sprache wie das Material. Gib nur die Zusammenfassung aus, ohne Vorrede.

Befolge diese Anweisungen (Masterprompt „${mp.name}“):
"""
${mp.text}
"""

Titel: ${d.title}`, {context:docContext(d), maxTokens:8000, signal:ctl.signal, onText: t => { if (S.busy.sum) { S.busy.sum.text = t; liveUpdate("#sumLive", t); } }});
    const s = {id:rid("m"), promptId:mp.id, promptName:mp.name, md:mdText.trim(), createdAt:Date.now()};
    d.summaries = [s, ...d.summaries].slice(0, 8); d.activeSummary = s.id; save(docId, d);
    toast("Neue Zusammenfassung erstellt");
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.busy.sum = null; renderMain();
}
let liveRaf = 0;
function liveUpdate(sel, text){
  cancelAnimationFrame(liveRaf);
  liveRaf = requestAnimationFrame(() => { const el = $(sel); if (el) el.innerHTML = md(text); });
}

/* ---------- Mindmap, Glossar, Lernzettel, Schwächen ---------- */
async function makeMindmap(docId){
  const d = S.docs[docId]; if (!d || !aiReady()) return toast(errText({code:"no_key"}));
  S.busy.mind = docId; renderMain();
  try {
    const out = await askJSON(`Erstelle eine Mindmap zum Lernmaterial oben. Höchstens 6 Hauptäste, je 2-5 Unteräste, optional eine dritte Ebene. Kurze Stichworte (max. 6 Wörter), Formeln in $...$.
Antworte NUR mit JSON: {"center":"Thema","branches":[{"label":"Ast","children":[{"label":"Unterast","children":[{"label":"Detail"}]}]}]}`, {context:docContext(d), maxTokens:4000});
    if (!arr(out?.branches).length) throw {code:"local", message:"Die Mindmap kam leer zurück. Versuch es noch einmal."};
    d.mindmap = {center:String(out.center || d.title), branches:out.branches}; save(docId, d);
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.busy.mind = null; renderMain();
}
async function makeGlossary(sid){
  const s = subj(sid); if (!s || !aiReady()) return toast(errText({code:"no_key"}));
  S.busy.gloss = sid; renderMain();
  try {
    const out = await askJSON(`Erstelle ein Glossar aller wichtigen Fachbegriffe aus dem folgenden Lernmaterial des Fachs „${s.name}“. 15 bis 60 Begriffe, jede Definition in 1-2 Sätzen, Formeln in $...$. Gleiche Sprache wie das Material.
Antworte NUR mit JSON: {"terms":[{"term":"Begriff","def":"Definition"}]}

MATERIAL:
${material("s:" + sid)}`, {maxTokens:8000});
    const terms = arr(out?.terms).filter(t => t && t.term && t.def).map(t => ({term:String(t.term), def:String(t.def)})).sort((a, b) => a.term.localeCompare(b.term, "de"));
    if (!terms.length) throw {code:"local", message:"Es kamen keine Begriffe zurück. Versuch es noch einmal."};
    s.glossary = terms; s.glossaryAt = Date.now(); saveProfile();
    toast(terms.length + " Begriffe im Glossar");
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.busy.gloss = null; renderMain();
}
async function makeSheet(sid, docIds, promptId){
  const s = subj(sid); if (!s) return;
  if (!aiReady()) return toast(errText({code:"no_key"}));
  if (!docIds.length) return toast("Wähle mindestens ein Dokument.");
  const mp = promptId ? promptById(promptId) : null;
  const ctl = new AbortController();
  S.busy.sheet = {sid, text:"", ctl}; renderMain();
  try {
    const mdText = await askText(`Erstelle aus dem folgenden Lernmaterial einen kompakten Klausur-Lernzettel für das Fach „${s.name}“ als Markdown. Führe die Dokumente zu einer logischen Gliederung zusammen (nicht Dokument für Dokument), mit ## Überschriften, Stichpunkten, **fett** für Kernbegriffe und Formeln in $...$. Gleiche Sprache wie das Material. Gib nur den Lernzettel aus.
${mp ? `\nBefolge zusätzlich diese Anweisungen (Masterprompt „${mp.name}“):\n"""\n${mp.text}\n"""\n` : ""}
MATERIAL:
${material(null, docIds)}`, {maxTokens:12000, signal:ctl.signal, onText: t => { if (S.busy.sheet) { S.busy.sheet.text = t; liveUpdate("#sheetLive", t); } }});
    const sh = {id:rid("z"), title:"Lernzettel " + new Date().toLocaleDateString("de-DE"), md:mdText.trim(), createdAt:Date.now(), docIds, promptName:mp?.name || ""};
    s.sheets = [sh, ...arr(s.sheets)].slice(0, 10); saveProfile();
    S.sel.sheet = sh.id; S.view = "faecher";
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.busy.sheet = null; render(); scrollTo(0,0);
}
async function analyzeWeak(sid){
  const s = subj(sid); if (!s) return;
  if (!aiReady()) return toast(errText({code:"no_key"}));
  const weak = allCards((id, d) => d.subjectId === sid).filter(x => isWeak(x.c) || (x.c.lapses || 0) >= 1).sort((a, b) => (b.c.lapses || 0) - (a.c.lapses || 0)).slice(0, 40);
  if (weak.length < 3) return toast("Noch zu wenig Daten. Lerne ein paar Tage, dann zeigt sich, wo es hakt.");
  S.busy.weak = sid; renderMain();
  try {
    const out = await askJSON(`Hier sind Karteikarten aus dem Fach „${s.name}“, die eine Studentin/ein Student oft falsch beantwortet (mit Anzahl der Fehler). Finde die dahinterliegenden Wissenslücken, gruppiere sie in 2 bis 5 Themen und erkläre jeweils kurz, woran es vermutlich liegt und wie man es lernt. Erstelle außerdem 8 neue Übungskarten, die genau diese Lücken von einer anderen Seite angehen (etwa 30 % Lückentexte, Formeln in $...$).
Antworte NUR mit JSON: {"themes":[{"name":"Thema","why":"Woran es liegt (1-2 Sätze)","tip":"Konkreter Lerntipp (1-2 Sätze)"}],"cards":[{"type":"basic","q":"...","a":"..."}]}

KARTEN:
${weak.map(x => `- (${x.c.lapses || 0}× falsch) F: ${x.c.q} | A: ${x.c.a}`).join("\n")}`, {maxTokens:5000});
    const themes = arr(out?.themes).filter(t => t && t.name).map(t => ({name:String(t.name), why:String(t.why || ""), tip:String(t.tip || "")}));
    s.weak = {date:Date.now(), themes}; saveProfile();
    const add = cardsFromAI(out?.cards).map(c => { delete c.page; return c; });
    if (add.length) {
      let entry = docsOf(sid).find(([, d]) => d.kind === "weak");
      if (!entry) {
        const id = rid("d");
        S.docs[id] = {type:"doc", kind:"weak", subjectId:sid, title:"Gezielte Übung: Schwachstellen", fileName:"Schwächen-Analyse", createdAt:Date.now(), summaries:[], topics:[], videos:[], cards:[], text:""};
        entry = [id, S.docs[id]];
      }
      const [id, d] = entry;
      d.cards = [...arr(d.cards), ...add];
      d.summaries = [{id:rid("m"), promptName:"Schwächen-Analyse", md:themes.map(t => `## ${t.name}\n${t.why}\n\n**Tipp:** ${t.tip}`).join("\n\n"), createdAt:Date.now()}, ...arr(d.summaries)].slice(0, 5);
      d.activeSummary = d.summaries[0].id; save(id, d);
    }
    toast(add.length ? add.length + " Übungskarten zu deinen Schwachstellen erstellt" : "Analyse fertig");
  } catch (e) { if (e?.code !== "cancelled") toast(errText(e)); }
  S.busy.weak = null; renderMain();
}

/* ---------- Abfrage ---------- */
function startReview(scope, mode = "plan"){
  const f = scopeFilter(scope);
  let reviews = [], fresh = [];
  if (mode === "all") reviews = shuffle(allCards(f)).slice(0, 60);
  else if (mode === "weak") reviews = shuffle(allCards(f).filter(x => isWeak(x.c))).slice(0, 40);
  else {
    reviews = shuffle(allCards(f).filter(x => isDue(x.c))).slice(0, 150);
    if (scope && scope.startsWith("d:")) fresh = allCards(f).filter(x => isNew(x.c)).slice(0, 15);
    else for (const p of planToday()) if (!scope || scope === "all" || scope === "s:" + p.s.id) fresh.push(...newCardsOf(p.s.id).slice(0, p.quota));
  }
  const items = [];
  while (reviews.length || fresh.length) { for (let i = 0; i < 2 && reviews.length; i++) items.push(reviews.shift()); if (fresh.length) items.push(fresh.shift()); }
  if (!items.length) { toast(mode === "weak" ? "Keine Schwachstellen gefunden." : "Gerade ist nichts fällig."); return; }
  S.review = {queue:items.map(x => ({docId:x.docId, cardId:x.c.id})), total:items.length, done:0, shown:false, counts:[0,0,0,0], scope, mode};
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
function grade(g){
  const R = S.review, cur = curCard(); if (!cur || !R.shown) return;
  const {d, c, it} = cur, now = Date.now(), wasNew = isNew(c);
  const k = dkey(), log = S.profile.log || (S.profile.log = {});
  (R.undo || (R.undo = [])).push({it, card:structuredClone(c), day:k, entry:log[k] ? structuredClone(log[k]) : null, queue:[...R.queue], done:R.done, counts:[...R.counts], t:now});
  if (R.undo.length > 20) R.undo.shift();
  const n = FSRS.next(c, g + 1, now);
  if (g === 0 && !wasNew) c.lapses = (c.lapses || 0) + 1;
  c.s = n.s; c.d = n.d; c.due = n.due; c.last = now; c.reps = (c.reps || 0) + 1; c.u = now;
  save(it.docId, d);
  const L = log[k] || (log[k] = {n:0, ok:0, newBy:{}});
  L.n = (L.n || 0) + 1; L.ok = (L.ok || 0) + (g > 0 ? 1 : 0);
  if (wasNew) { L.newBy = L.newBy || {}; L.newBy[d.subjectId] = (L.newBy[d.subjectId] || 0) + 1; }
  const keys = Object.keys(log).sort(); while (keys.length > 180) delete log[keys.shift()];
  saveProfile();
  S.revlog.items.push([c.id, now, g + 1, wasNew ? 1 : 0]);
  if (S.revlog.items.length > REVLOG_MAX) S.revlog.items.splice(0, S.revlog.items.length - REVLOG_MAX);
  saveRevlog();
  R.counts[g]++; R.queue.shift();
  if (g === 0) R.queue.splice(Math.min(R.queue.length, 3), 0, it); else R.done++;
  R.shown = false; renderMain(); updateBadge();
}
/* Letzte Bewertung zurücknehmen: Karte, Tageslog, Lernverlauf und Warteschlange wie vorher */
function undoGrade(){
  const R = S.review, u = R?.undo?.pop(); if (!u) return;
  const d = S.docs[u.it.docId], c = d && arr(d.cards).find(x => x.id === u.card.id);
  if (c) { for (const key of Object.keys(c)) delete c[key]; Object.assign(c, u.card, {u:Date.now()}); save(u.it.docId, d); }
  const log = S.profile.log || (S.profile.log = {});
  if (u.entry) log[u.day] = u.entry; else delete log[u.day];
  saveProfile();
  const rk = u.card.id + "|" + u.t;
  S.revlog.items = S.revlog.items.filter(x => x[0] + "|" + x[1] !== rk);
  S.revlog.del = [...arr(S.revlog.del), rk].slice(-TOMB_MAX);
  saveRevlog();
  R.queue = u.queue; R.done = u.done; R.counts = u.counts; R.shown = true;
  renderMain(); updateBadge(); toast("Bewertung zurückgenommen");
}

/* ---------- Erklär-Chat ---------- */
function openExplain(docId, cardId){
  S.explain = {docId, cardId, msgs:[], busy:false, ctl:null, live:"", error:""};
  renderSheet();
  sendExplain("Erklär mir die Antwort genauer und gib ein Beispiel.");
}
async function sendExplain(q){
  const E = S.explain; if (!E || E.busy || !q.trim()) return;
  const d = S.docs[E.docId], c = d && arr(d.cards).find(x => x.id === E.cardId); if (!c) return;
  if (!aiReady()) { E.error = errText({code:"no_key"}); return renderSheet(); }
  E.msgs.push({role:"user", content:q.trim()}); E.busy = true; E.live = ""; E.error = ""; E.ctl = new AbortController(); renderSheet();
  const sum = d.summaries.find(x => x.id === d.activeSummary) || d.summaries[0];
  const ctx = `Du bist ein geduldiger Tutor an der Uni. Eine Studentin/ein Student lernt gerade mit dieser Karteikarte aus dem Lernmaterial oben:
Frage: ${c.q}
Antwort: ${c.a}
${sum ? "Zusammenfassung des Dokuments:\n" + sum.md.slice(0, 4000) : ""}

Antworte auf Deutsch, verständlich und knapp (höchstens 180 Wörter). Nutze Beispiele. Formeln in LaTeX zwischen $...$. Markdown ist erlaubt.

`;
  const messages = E.msgs.map((m, i) => ({role:m.role, content: i === 0 ? ctx + "Frage: " + m.content : m.content}));
  try {
    const t = await callClaude({messages, system:cachedSystem(docContext(d)), maxTokens:1500, signal:E.ctl.signal, onText: x => { E.live = x; liveUpdate("#explainLive", x); }});
    E.msgs.push({role:"assistant", content:t});
  } catch (e) {
    if (e?.code !== "cancelled") E.error = errText(e);
    if (E.live) E.msgs.push({role:"assistant", content:E.live}); else E.msgs.pop();
  }
  E.busy = false; E.live = ""; renderSheet();
}

/* ---------- Übungsklausur ---------- */
async function examStart(){
  const E = S.exam;
  if (!aiReady()) { E.error = errText({code:"no_key"}); return renderMain(); }
  const m = material(E.scope);
  if (!m.trim()) { E.error = "Für diese Auswahl gibt es noch kein Material."; return renderMain(); }
  E.stage = "loading"; E.error = ""; E.ctl = new AbortController(); renderMain();
  try {
    const out = await askJSON(`Erstelle eine Übungsklausur mit ${E.n} Aufgaben auf Uni-Niveau aus dem Lernmaterial oben. Mische etwa 60 % Multiple Choice (genau 4 Optionen, genau eine richtig) und 40 % offene Aufgaben. Prüfe Verständnis und Anwendung, nicht nur Auswendiglernen. Formeln in $...$. Gleiche Sprache wie das Material.
Antworte NUR mit JSON: {"questions":[{"type":"mc","q":"Frage","options":["A","B","C","D"],"correct":0,"explain":"warum diese Antwort stimmt (1-2 Sätze)"},{"type":"open","q":"Aufgabe","model":"Musterlösung in 2-5 Sätzen","points":4}]}`, {context:m, signal:E.ctl.signal, maxTokens:10000});
    const qs = arr(out?.questions).filter(q => q && q.q && (q.type === "open" || (arr(q.options).length >= 2 && Number.isInteger(q.correct))));
    if (!qs.length) throw {code:"local", message:"Es kamen keine brauchbaren Aufgaben zurück. Versuch es noch einmal."};
    E.questions = qs.map(q => q.type === "open" ? {type:"open", q:String(q.q), model:String(q.model || ""), points:clamp(Number(q.points) || 4, 1, 10)} : {type:"mc", q:String(q.q), options:arr(q.options).map(String), correct:q.correct, explain:String(q.explain || ""), points:1});
    E.answers = {}; E.stage = "taking";
  } catch (e) { E.stage = "setup"; if (e?.code !== "cancelled") E.error = errText(e); }
  renderMain(); scrollTo(0,0);
}
async function examSubmit(){
  const E = S.exam; E.stage = "grading"; E.ctl = new AbortController(); renderMain();
  const res = E.questions.map((q, i) => q.type === "mc" ? {score:E.answers[i] === q.correct ? 1 : 0} : {score:0, feedback:""});
  const open = E.questions.map((q, i) => ({i, q})).filter(x => x.q.type === "open");
  const answered = open.filter(x => String(E.answers[x.i] || "").trim());
  open.filter(x => !String(E.answers[x.i] || "").trim()).forEach(x => res[x.i].feedback = "Keine Antwort abgegeben.");
  if (answered.length) {
    try {
      const out = await askJSON(`Du bist Tutor und korrigierst offene Klausuraufgaben fair und konkret. Vergib für jede Antwort Punkte zwischen 0 und der Maximalpunktzahl (halbe Punkte erlaubt) und schreibe 1-2 Sätze Feedback: was gut war und was fehlt. Gleiche Sprache wie die Aufgabe.
Antworte NUR mit JSON: {"results":[{"i":0,"score":2.5,"feedback":"..."}]}

AUFGABEN:
${JSON.stringify(answered.map(x => ({i:x.i, aufgabe:x.q.q, musterloesung:x.q.model, maxPunkte:x.q.points, antwort:String(E.answers[x.i]).slice(0,4000)})))}`, {signal:E.ctl.signal, maxTokens:4000});
      for (const r of arr(out?.results)) { const q = E.questions[r.i]; if (q && q.type === "open") res[r.i] = {score:clamp(Number(r.score) || 0, 0, q.points), feedback:String(r.feedback || "")}; }
    } catch (e) {
      if (e?.code === "cancelled") { E.stage = "taking"; return renderMain(); }
      answered.forEach(x => res[x.i].feedback = "Konnte nicht automatisch bewertet werden: " + errText(e) + " Vergleiche selbst mit der Musterlösung.");
    }
  }
  E.results = res;
  const max = E.questions.reduce((s, q) => s + q.points, 0), got = res.reduce((s, r) => s + r.score, 0);
  E.pct = Math.round(got / max * 100);
  const xid = "x-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  S.examDetails[xid] = {type:"exam", questions:E.questions, answers:E.answers, results:E.results}; save(xid, S.examDetails[xid]);
  const all = [{id:xid, date:Date.now(), scope:E.scope, label:scopeLabel(E.scope), pct:E.pct, detail:true}, ...arr(S.profile.exams)];
  for (const x of all.slice(20)) if (S.examDetails[x.id]) { delete S.examDetails[x.id]; remove(x.id); }
  S.profile.exams = all.slice(0, 20);
  saveProfile();
  E.stage = "done"; renderMain(); scrollTo(0,0);
}

/* Frühere Klausur mit Aufgaben, Antworten und Korrektur wieder öffnen */
function openExam(id){
  const x = arr(S.profile.exams).find(e => e.id === id), det = S.examDetails[id];
  if (!x || !det) return toast("Für diese Klausur sind keine Aufgaben gespeichert.");
  S.exam = {stage:"done", scope:x.scope, n:det.questions.length, questions:det.questions, answers:det.answers || {}, results:det.results, pct:x.pct, past:x.date};
  S.examTab = "exam"; S.view = "klausur"; render(); scrollTo(0, 0);
}

/* ---------- YouTube ---------- */
const decodeHtml = t => new DOMParser().parseFromString(String(t || ""), "text/html").documentElement.textContent;
async function loadVideos(docId){
  const d = S.docs[docId]; if (!d) return;
  if (!settings.ytKey) return toast("Trag zuerst einen YouTube-API-Schlüssel in den Einstellungen ein.");
  S.busy.vid = docId; renderMain();
  try {
    const results = [];
    for (const v of arr(d.videos)) {
      const u = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=2&safeSearch=strict&relevanceLanguage=de&q=" + encodeURIComponent(v.query) + "&key=" + encodeURIComponent(settings.ytKey);
      const r = await fetch(u);
      if (!r.ok) { let m = ""; try { m = (await r.json())?.error?.message || ""; } catch {} throw {code:"local", message:"YouTube hat die Anfrage abgelehnt" + (m ? ": " + m : ". Prüfe den Schlüssel.")}; }
      const j = await r.json();
      results.push({title:v.title, query:v.query, why:v.why, items:arr(j.items).filter(it => it.id?.videoId).map(it => ({id:it.id.videoId, title:decodeHtml(it.snippet.title), channel:decodeHtml(it.snippet.channelTitle), thumb:it.snippet.thumbnails?.medium?.url || ""}))});
    }
    d.videoResults = results; d.videoAt = Date.now(); save(docId, d);
  } catch (e) { toast(errText(e)); }
  S.busy.vid = null; renderMain();
}

/* ---------- Teilen ---------- */
/* Stapel zum Teilen; Abbildungen gehen in den öffentlichen Bucket "share-img" unter <user>/<code>/ */
async function deckOf(docIds, code){
  const docs = [], up = new Map(); let n = 0;
  for (const d of docIds.map(i => S.docs[i]).filter(Boolean)) {
    const cards = [];
    for (const c of arr(d.cards)) {
      const x = {kind:c.kind, q:c.q, a:c.a};
      if (c.img && (up.has(c.img) || n < 60)) {
        if (!up.has(c.img)) {
          const b = await imgBlob(c.img), path = `${Sync.uid}/${code}/${n++}.jpg`;
          const r = b ? await Sync.client.storage.from("share-img").upload(path, b, {contentType:"image/jpeg"}).catch(e => ({error:e})) : {error:true};
          up.set(c.img, r.error ? null : path);
        }
        if (up.get(c.img)) x.img = up.get(c.img);
      }
      cards.push(x);
    }
    docs.push({title:d.title, fileName:d.fileName, topics:d.topics, videos:d.videos, mindmap:d.mindmap || null,
      summaries:arr(d.summaries).slice(0,3).map(({promptName, md}) => ({promptName, md})), text:(d.text || "").slice(0, 20000), cards});
  }
  return docs;
}
async function createShare(kind, id){
  if (!Sync.configured) return toast("Teilen per Link braucht die Server-Verbindung (Einstellungen).");
  if (!Sync.uid) { toast("Melde dich in den Einstellungen an, um Links zu teilen."); S.view = "settings"; return render(); }
  const docIds = kind === "doc" ? [id] : docsOf(id).map(([i]) => i);
  const sName = kind === "doc" ? subj(S.docs[id]?.subjectId)?.name : subj(id)?.name;
  const title = kind === "doc" ? S.docs[id].title : sName;
  S.busy.share = id; renderMain();
  try {
    const code = code6() + code6().slice(0, 2);
    const {error} = await Sync.client.from("shares").insert({id:code, owner:Sync.uid, title, deck:{v:2, title, subjectName:sName || "", docs:await deckOf(docIds, code)}});
    if (error) throw {code:"local", message:"Teilen hat nicht geklappt: " + error.message};
    S.share = {target:id, url:location.origin + location.pathname + "?s=" + code, title};
  } catch (e) { toast(errText(e)); }
  S.busy.share = null; renderMain();
}
async function nativeShare(){
  const sh = S.share; if (!sh) return;
  if (navigator.share) { try { await navigator.share({title:sh.title, text:"Karteikarten: " + sh.title, url:sh.url}); return; } catch {} }
  copyText(sh.url);
}
async function loadShare(code){
  S.importShare = {code, loading:true}; S.view = "import"; render();
  if (!Sync.configured) { S.importShare = {code, error:"Diese App ist nicht mit einem Server verbunden, deshalb kann der Link nicht geöffnet werden."}; return renderMain(); }
  const {data, error} = await Sync.client.from("shares").select("title,deck,created_at").eq("id", code).maybeSingle();
  if (error || !data) S.importShare = {code, error:"Dieser Link ist ungültig oder wurde gelöscht."};
  else S.importShare = {code, data, subjectId:"__new", newSubject:data.deck.subjectName || data.title};
  renderMain();
}
async function importShare(){
  const I = S.importShare; if (!I?.data || I.busy) return;
  let sid = I.subjectId;
  if (sid === "__new") { const n = (I.newSubject || "").trim(); if (!n) return toast("Gib dem Fach einen Namen."); sid = addSubject(n); }
  I.busy = true; renderMain();
  let n = 0, firstId = null;
  for (const x of arr(I.data.deck.docs)) {
    const id = rid("d"); firstId = firstId || id;
    const sums = arr(x.summaries).map(s => ({id:rid("m"), promptName:s.promptName || "Geteilt", md:String(s.md || ""), createdAt:Date.now()}));
    const src = arr(x.cards).filter(c => c && c.q), cards = src.map(c => newCard(c.q, c.a, c.kind)), got = new Map();
    for (let i = 0; i < src.length; i++) {
      const p = src[i].img; if (!p || !Sync.client) continue;
      if (!got.has(p)) {
        let key = null;
        try { const r = await fetch(Sync.client.storage.from("share-img").getPublicUrl(p).data.publicUrl); if (r.ok) { key = id + ":s" + got.size; await saveImg(key, await r.blob()); } } catch {}
        got.set(p, key);
      }
      if (got.get(p)) cards[i].img = got.get(p);
    }
    n += cards.length;
    S.docs[id] = normDoc({type:"doc", subjectId:sid, title:String(x.title || "Geteilt").slice(0,140), fileName:"Geteilt: " + (x.fileName || ""), createdAt:Date.now(), summaries:sums, activeSummary:sums[0]?.id, topics:arr(x.topics), videos:arr(x.videos), mindmap:x.mindmap || undefined, cards, text:String(x.text || "")});
    save(id, S.docs[id]);
  }
  S.importShare = null; history.replaceState(null, "", location.pathname);
  toast(n + " Karten übernommen");
  S.view = "faecher"; S.sel = {subject:sid, doc:firstId, sheet:null}; render();
}

/* ---------- Quiz-Duell ---------- */
let duelPoll = null, duelTimer = null;
const DUEL_SECONDS = 20;
function stopDuelPoll(){ clearInterval(duelPoll); duelPoll = null; }
function startDuelPoll(){
  stopDuelPoll(); refreshPlayers();
  duelPoll = setInterval(() => {
    if (S.view !== "klausur" || S.examTab !== "duel" || !S.duel || !["lobby","result"].includes(S.duel.stage)) return stopDuelPoll();
    refreshPlayers();
  }, 4000);
}
async function refreshPlayers(){
  const D = S.duel; if (!D?.id || !Sync.client) return;
  const {data} = await Sync.client.from("duel_players").select("user_id,name,score,correct,finished").eq("duel_id", D.id).order("score", {ascending:false});
  if (data && S.duel === D) { D.players = data; if (["lobby","result"].includes(D.stage) && S.view === "klausur") renderMain(); }
}
async function createDuel(){
  const D = S.duel;
  if (!Sync.uid) return toast("Melde dich an, um ein Duell zu starten.");
  if (!aiReady()) { D.error = errText({code:"no_key"}); return renderMain(); }
  const m = material(D.scope);
  if (!m.trim()) { D.error = "Für diese Auswahl gibt es noch kein Material."; return renderMain(); }
  D.stage = "creating"; D.error = ""; renderMain();
  try {
    const out = await askJSON(`Erstelle ${D.n} Multiple-Choice-Fragen für ein Quiz-Duell unter Studierenden aus dem Lernmaterial oben. Je genau 4 kurze Optionen, genau eine richtig. Fragen kurz genug, um sie in 20 Sekunden zu lesen und zu beantworten. Formeln in $...$. Gleiche Sprache wie das Material.
Antworte NUR mit JSON: {"questions":[{"q":"Frage","options":["A","B","C","D"],"correct":0}]}`, {context:m, maxTokens:5000});
    const qs = arr(out?.questions).filter(q => q && q.q && arr(q.options).length === 4 && Number.isInteger(q.correct)).map(q => ({q:String(q.q), options:q.options.map(String), correct:q.correct}));
    if (qs.length < 3) throw {code:"local", message:"Es kamen zu wenige Fragen zurück. Versuch es noch einmal."};
    const id = code6(), title = scopeLabel(D.scope);
    const {error} = await Sync.client.from("duels").insert({id, host:Sync.uid, title, questions:qs});
    if (error) throw {code:"local", message:"Duell konnte nicht gespeichert werden: " + error.message};
    Object.assign(D, {stage:"lobby", id, data:{title, questions:qs, host:Sync.uid}, players:[]});
    startDuelPoll();
  } catch (e) { D.stage = "menu"; D.error = errText(e); }
  renderMain();
}
async function joinDuel(code){
  code = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) { S.duel.error = "Der Code hat 6 Zeichen."; return renderMain(); }
  if (!Sync.uid) { S.duel.error = "Melde dich in den Einstellungen an, um mitzuspielen."; return renderMain(); }
  S.duel.stage = "joining"; renderMain();
  const {data, error} = await Sync.client.from("duels").select("id,title,questions,host").eq("id", code).maybeSingle();
  if (error || !data) { S.duel = {...S.duel, stage:"menu", error:"Kein Duell mit diesem Code gefunden."}; return renderMain(); }
  S.duel = {...S.duel, stage:"lobby", id:data.id, data, players:[], error:""};
  startDuelPoll(); renderMain();
}
function startPlay(){
  const D = S.duel; if (!D?.data) return;
  if (!(S.profile.prefs.displayName || "").trim()) return toast("Gib zuerst deinen Namen für die Rangliste ein.");
  if (arr(D.players).some(p => p.user_id === Sync.uid && p.finished)) return toast("Du hast dieses Duell schon gespielt.");
  stopDuelPoll();
  D.play = {i:0, score:0, correct:0, picked:null, t0:Date.now()};
  D.stage = "play"; renderMain(); tickDuel();
}
function tickDuel(){
  clearInterval(duelTimer);
  duelTimer = setInterval(() => {
    const D = S.duel; if (!D || D.stage !== "play" || S.view !== "klausur") return clearInterval(duelTimer);
    const P = D.play; if (P.picked !== null) return;
    const left = DUEL_SECONDS - (Date.now() - P.t0) / 1000;
    const bar = $("#duelBar"); if (bar) bar.style.width = clamp(left / DUEL_SECONDS * 100, 0, 100) + "%";
    if (left <= 0) duelAnswer(-1);
  }, 100);
}
function duelAnswer(j){
  const D = S.duel, P = D?.play; if (!P || P.picked !== null) return;
  const q = D.data.questions[P.i], left = Math.max(0, DUEL_SECONDS - (Date.now() - P.t0) / 1000);
  P.picked = j;
  if (j === q.correct) { P.correct++; P.score += 100 + Math.round(100 * left / DUEL_SECONDS); }
  renderMain();
  setTimeout(() => {
    if (S.duel !== D) return;
    if (P.i + 1 >= D.data.questions.length) return finishDuel();
    P.i++; P.picked = null; P.t0 = Date.now(); renderMain();
  }, 1400);
}
async function finishDuel(){
  const D = S.duel; clearInterval(duelTimer);
  D.stage = "result"; renderMain();
  const {error} = await Sync.client.from("duel_players").upsert({duel_id:D.id, user_id:Sync.uid, name:S.profile.prefs.displayName.trim().slice(0, 30), score:D.play.score, correct:D.play.correct, finished:true});
  if (error) toast("Ergebnis konnte nicht gespeichert werden: " + error.message);
  startDuelPoll();
}

/* ---------- PDF-Export (Zusammenfassung, Lernzettel) ----------
   html2pdf.js wird erst beim ersten Klick geladen (ca. 900 KB) und danach vom Service Worker offline vorgehalten. */
const HTML2PDF_URL = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
function loadScript(src){
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("load")); document.head.append(s); });
}
const pdfName = s => String(s || "Dokument").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Dokument";
async function downloadPdf({key, kind, title, subtitle, mdText}){
  if (S.busy.pdf) return;
  S.busy.pdf = key; renderMain();
  let host;
  try {
    if (!window.html2pdf) { try { await loadScript(HTML2PDF_URL); } catch {} }
    if (!window.html2pdf) throw {code:"local", message:"Der PDF-Baustein konnte nicht geladen werden. Prüfe die Internetverbindung oder nutze „Drucken“ und dort „Als PDF sichern“."};
    host = document.createElement("div"); host.className = "pdfhost";
    host.innerHTML = `<article class="pdfdoc"><header><div class="pdfbrand">Semesterkartei · ${esc(kind)}</div><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header><div class="md">${md(mdText)}</div></article>`;
    document.body.append(host);
    renderMath(host);
    // Überschrift immer mit dem folgenden Absatz zusammenhalten (keine einsame Überschrift am Seitenende)
    for (const h of host.querySelectorAll(".md > h2, .md > h3, .md > h4")) {
      const nx = h.nextElementSibling; if (!nx || /^H[2-4]$/.test(nx.tagName)) continue;
      const w = document.createElement("div"); w.className = "keep"; h.before(w); w.append(h, nx);
    }
    try { await document.fonts?.ready; } catch {}
    const footer = (kind + " · " + title).replace(/[^\x20-\xFF]/g, "").slice(0, 90);
    await html2pdf().set({
      margin:[14, 14, 16, 14], filename:pdfName(title.startsWith(kind) ? title : kind + " - " + title) + ".pdf",
      image:{type:"jpeg", quality:0.92},
      html2canvas:{scale:2, backgroundColor:"#ffffff", useCORS:true},
      jsPDF:{unit:"mm", format:"a4", orientation:"portrait"},
      pagebreak:{mode:["css", "legacy"], avoid:[".keep", "h2", "h3", "h4", "li", "p", ".katex-display"]}
    }).from(host.firstElementChild).toPdf().get("pdf").then(pdf => {
      const n = pdf.internal.getNumberOfPages();
      for (let i = 1; i <= n; i++) { pdf.setPage(i); pdf.setFontSize(8); pdf.setTextColor(140); pdf.text(`${footer}   ·   Seite ${i} von ${n}`, 105, 289, {align:"center"}); }
    }).save();
    toast("PDF gespeichert");
  } catch (e) { toast(errText(e)); }
  host?.remove();
  S.busy.pdf = null; renderMain();
}
function pdfSummary(docId){
  const d = S.docs[docId]; if (!d) return;
  const sum = d.summaries.find(x => x.id === d.activeSummary) || d.summaries[0];
  if (!sum) return toast("Für dieses Dokument gibt es noch keine Zusammenfassung.");
  const parts = [subj(d.subjectId)?.name, sum.promptName && "Masterprompt „" + sum.promptName + "“", new Date(sum.createdAt || Date.now()).toLocaleDateString("de-DE")].filter(Boolean);
  downloadPdf({key:"sum:" + docId, kind:"Zusammenfassung", title:d.title, subtitle:parts.join(" · "), mdText:sum.md});
}
function pdfSheet(sid, shid){
  const s = subj(sid), sh = arr(s?.sheets).find(x => x.id === shid); if (!sh) return;
  const parts = [s.name, sh.docIds.length + (sh.docIds.length === 1 ? " Dokument" : " Dokumente"), new Date(sh.createdAt || Date.now()).toLocaleDateString("de-DE")];
  downloadPdf({key:"sheet:" + shid, kind:"Lernzettel", title:sh.title, subtitle:parts.join(" · "), mdText:sh.md});
}

/* ---------- FSRS an den eigenen Lernverlauf anpassen ---------- */
const fsrsUsable = () => FSRS.loss(FSRS.DEFAULT, FSRS.sequences(S.revlog.items)).n;
async function optimizeFsrs(){
  if (S.busy.fsrs) return;
  S.busy.fsrs = true; renderMain();
  try {
    const r = await FSRS.optimize(S.revlog.items, {onStep:(i, n) => { const el = $("#fsrsProg"); if (el) el.textContent = `Rechne… Schritt ${i} von ${n}`; }});
    if (!r.ok) toast(`Dafür braucht die App mindestens 200 Wiederholungen mit Verlauf. Bisher: ${r.n}.`);
    else { S.profile.prefs.fsrsW = r.W; S.profile.prefs.fsrsInfo = {date:Date.now(), n:r.n, before:r.before, after:r.after}; saveProfile(); toast("Die Wiederholungsabstände sind jetzt an dich angepasst"); }
  } catch { toast("Die Anpassung hat nicht geklappt."); }
  S.busy.fsrs = null; renderMain();
}
function resetFsrs(){ S.profile.prefs.fsrsW = null; S.profile.prefs.fsrsInfo = null; saveProfile(); toast("Standardwerte wiederhergestellt"); renderMain(); }

/* ---------- Backup, Erinnerung, Beispiel ---------- */
function exportBackup(){
  const data = JSON.stringify({app:"semesterkartei", version:3, exportedAt:new Date().toISOString(), profile:S.profile, docs:S.docs, revlog:S.revlog, examDetails:S.examDetails});
  downloadBlob("semesterkartei-backup-" + dkey() + ".json", new Blob([data], {type:"application/json"}));
}
async function importBackup(file){
  try {
    const d = JSON.parse(await file.text());
    if (d.app !== "semesterkartei" || !d.profile || typeof d.docs !== "object") throw new Error();
    S.profile = normProfile(d.profile); saveProfile();
    for (const [id, doc] of Object.entries(d.docs)) if (doc && doc.type === "doc") { S.docs[id] = normDoc(doc); save(id, S.docs[id]); }
    if (d.revlog) { S.revlog = mergeRevlog(S.revlog, d.revlog); saveRevlog(); }
    for (const [id, x] of Object.entries(d.examDetails || {})) if (x && x.type === "exam") { S.examDetails[id] = x; save(id, x); }
    toast("Backup importiert"); S.view = "heute"; render();
  } catch { toast("Diese Datei ist kein gültiges Semesterkartei-Backup."); }
}
async function wipeAll(){
  for (const id of Object.keys(S.docs)) remove(id);
  for (const id of Object.keys(S.examDetails)) remove(id);
  S.docs = {}; S.examDetails = {}; S.profile = defaultProfile(); saveProfile();
  S.revlog = {type:"revlog", items:[], del:[]}; saveRevlog();
  if (idb) tx("img","readwrite", st => st.clear()).catch(() => {});
  S.confirm = null; toast("Alle Daten gelöscht"); S.view = "heute"; render();
}
function reminderIcs(time){
  const [h, m] = (time || "18:00").split(":").map(Number);
  const start = new Date(); start.setHours(h, m, 0, 0); if (start < new Date()) start.setDate(start.getDate() + 1);
  const p = n => String(n).padStart(2, "0");
  const local = d => d.getFullYear() + p(d.getMonth()+1) + p(d.getDate()) + "T" + p(d.getHours()) + p(d.getMinutes()) + "00";
  const utc = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const url = location.origin + location.pathname;
  const ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Semesterkartei//DE","CALSCALE:GREGORIAN","BEGIN:VEVENT",
    "UID:" + rid("rem") + "@semesterkartei","DTSTAMP:" + utc,"DTSTART:" + local(start),"DURATION:PT20M","RRULE:FREQ=DAILY",
    "SUMMARY:Karteikarten lernen","DESCRIPTION:Deine fälligen Karten warten: " + url,"URL:" + url,
    "BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:Zeit für deine Karteikarten","TRIGGER:PT0M","END:VALARM","END:VEVENT","END:VCALENDAR"].join("\r\n");
  S.profile.prefs.reminder = time; saveProfile();
  downloadBlob("lern-erinnerung.ics", new Blob([ics], {type:"text/calendar"}));
}
function loadExample(){
  const sid = addSubject("Biologie (Beispiel)");
  const cards = [
    ["basic","Wo findet die Glykolyse statt?","Im Cytoplasma der Zelle."],
    ["basic","Was ist die Bruttogleichung der Zellatmung?","$C_6H_{12}O_6 + 6\\,O_2 \\rightarrow 6\\,CO_2 + 6\\,H_2O$; dabei wird Energie als ATP frei."],
    ["cloze","Die Glykolyse liefert netto {{2 ATP}} und {{2 NADH}} pro Glucose.",""],
    ["basic","Wo läuft der Citratzyklus ab?","In der Matrix der Mitochondrien."],
    ["basic","Welche Rolle spielt Sauerstoff in der Atmungskette?","Er ist der letzte Elektronenakzeptor und wird zu Wasser reduziert."],
    ["cloze","Die ATP-Synthase wird vom {{Protonengradienten}} über der {{inneren Mitochondrienmembran}} angetrieben.","Das Prinzip heißt Chemiosmose."],
    ["basic","Was passiert mit Pyruvat ohne Sauerstoff?","Es wird vergoren, z. B. zu Laktat oder zu Ethanol und $CO_2$, um $NAD^+$ zu regenerieren."],
    ["cloze","Bei der oxidativen Decarboxylierung wird Pyruvat zu {{Acetyl-CoA}} umgewandelt.","Dabei werden $CO_2$ und NADH frei."]
  ].map(([k, q, a]) => newCard(q, a, k));
  const id = rid("d"), mid = rid("m");
  S.docs[id] = {type:"doc", subjectId:sid, title:"Beispiel: Zellatmung", fileName:"Beispiel", createdAt:Date.now(),
    summaries:[{id:mid, promptId:"p-standard", promptName:"Standard", createdAt:Date.now(), md:"Die **Zellatmung** gewinnt aus Glucose Energie in Form von ATP:\n\n$$C_6H_{12}O_6 + 6\\,O_2 \\rightarrow 6\\,CO_2 + 6\\,H_2O$$\n\n## Ablauf\n- **Glykolyse** im Cytoplasma: Glucose → 2 Pyruvat, netto 2 ATP\n- **Oxidative Decarboxylierung**: Pyruvat → Acetyl-CoA\n- **Citratzyklus** in der Mitochondrienmatrix\n- **Atmungskette** an der inneren Membran: der größte Teil des ATP\n\n## Ohne Sauerstoff\nNur die **Gärung** bleibt, mit geringer ATP-Ausbeute."}],
    activeSummary:mid, topics:["Glykolyse","Citratzyklus","Atmungskette","ATP","Gärung"],
    videos:[{title:"Zellatmung im Überblick", query:"Zellatmung einfach erklärt", why:"Zeigt alle vier Schritte im Zusammenhang."},{title:"Atmungskette und ATP-Synthase", query:"Atmungskette ATP Synthase Animation", why:"Die Chemiosmose versteht man am besten animiert."},{title:"Citratzyklus Schritt für Schritt", query:"Citratzyklus Schritt für Schritt erklärt", why:"Für die Details, die in Klausuren gern abgefragt werden."}],
    cards, text:"Zellatmung: Glykolyse im Cytoplasma (Glucose zu 2 Pyruvat, netto 2 ATP und 2 NADH), oxidative Decarboxylierung (Pyruvat zu Acetyl-CoA), Citratzyklus in der Mitochondrienmatrix, Atmungskette an der inneren Mitochondrienmembran mit ATP-Synthase (Chemiosmose). Ohne Sauerstoff: Gärung zu Laktat oder Ethanol."};
  save(id, S.docs[id]);
  S.view = "faecher"; S.sel = {subject:sid, doc:id, sheet:null}; render();
}
