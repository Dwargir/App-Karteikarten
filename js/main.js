"use strict";
/* Rendern, Ereignisse, Start */

const VIEWS = {heute:vHeute, faecher:vFaecher, upload:vUpload, review:vReview, klausur:vKlausur, stats:vStats, settings:vSettings, import:vImport};
function renderHeader(){
  const el = $("#status"); if (!el) return;
  let m;
  if (S.store === "loading") m = ["Lädt…", ""];
  else if (S.store === "memory") m = ["Nicht gespeichert", "warn"];
  else if (Sync.uid) m = Sync.state === "syncing" ? ["Sync…", ""] : Sync.state === "error" ? ["Sync-Fehler", "bad"] : ["Synchronisiert", "good"];
  else m = ["Auf diesem Gerät", "good"];
  if (!navigator.onLine) m = ["Offline", "warn"];
  el.textContent = m[0]; el.className = "chip " + m[1];
  const tab = S.view === "review" ? "heute" : S.view === "import" ? "faecher" : S.view;
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.v === tab));
}
function renderMain(){
  const main = $("#main");
  main.innerHTML = VIEWS[S.view]();
  renderMath(main); hydrateImages(main); updateBadge();
}
function render(){ renderHeader(); renderMain(); }
function softRender(){
  renderHeader();
  const a = document.activeElement;
  if (["upload","review"].includes(S.view) || S.cardEdit) return;
  if (S.view === "klausur" && ((S.exam && S.exam.stage !== "setup") || (S.duel && S.duel.stage === "play"))) return;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
  renderMain();
}
function renderStage(){ const el = $("#genStage"); if (el) el.textContent = S.upload.stage; }
const go = (view, sel) => { S.view = view; if (sel) S.sel = {subject:null, doc:null, sheet:null, ...sel}; S.confirm = null; S.share = null; S.cardEdit = null; render(); scrollTo(0, 0); };

const ACT = {
  nav(v){ if (S.view === v && v === "faecher") S.sel = {subject:null, doc:null, sheet:null}; go(v); },
  openSubj(v){ go("faecher", {subject:v}); },
  openDoc(v){ go("faecher", {subject:S.docs[v]?.subjectId, doc:v}); },
  openSheet(v){ go("faecher", {subject:S.sel.subject, sheet:v}); },
  back(){ go("faecher", {}); },
  uploadTo(v){ S.upload.subjectId = v; go("upload"); },
  example: loadExample,
  review(v){ startReview(v, "plan"); },
  reviewAll(v){ startReview(v, "all"); },
  reviewWeak(v){ startReview(v, "weak"); },
  reveal(){ if (S.review && !S.review.shown) { S.review.shown = true; renderMain(); } },
  grade(v){ grade(Number(v)); },
  endReview(){ S.review = null; go("heute"); },
  confirm(v){ S.confirm = v; renderMain(); },
  cancel(){ S.confirm = null; renderMain(); },
  delDoc(id){ delete S.docs[id]; remove(id); S.sel.doc = null; S.confirm = null; toast("Dokument gelöscht"); render(); },
  delSubj(sid){
    for (const [id] of docsOf(sid)) { delete S.docs[id]; remove(id); }
    S.profile.subjects = S.profile.subjects.filter(s => s.id !== sid); addTomb(S.profile.delSubjects, sid); saveProfile();
    toast("Fach gelöscht"); go("faecher", {});
  },
  delSheet(v){ const [sid, shid] = v.split("|"); const s = subj(sid); if (s) { s.sheets = arr(s.sheets).filter(x => x.id !== shid); saveProfile(); } go("faecher", {subject:sid}); },
  delCard(v){ const [id, cid] = v.split("|"); deleteCard(id, cid); renderMain(); },
  editCard(v){ S.cardEdit = v; renderMain(); $("#ecQ")?.focus(); },
  cancelEdit(){ S.cardEdit = null; renderMain(); },
  undo: undoGrade,
  examOpen(v){ openExam(v); },
  fsrsOpt: optimizeFsrs,
  fsrsReset: resetFsrs,
  more(v){ moreCards(v); },
  mind(v){ makeMindmap(v); },
  gloss(v){ makeGlossary(v); },
  weak(v){ analyzeWeak(v); },
  videos(v){ loadVideos(v); },
  playVid(v, t){ const f = document.createElement("iframe"); f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(v) + "?autoplay=1&rel=0"; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.allowFullscreen = true; f.className = "vframe"; f.title = "YouTube-Video"; t.replaceWith(f); },
  pickSum(v){ const [id, sid] = v.split("|"); const d = S.docs[id]; if (d) { d.activeSummary = sid; save(id, d); renderMain(); } },
  delSum(v){ const [id, sid] = v.split("|"); const d = S.docs[id]; if (!d) return; d.summaries = d.summaries.filter(x => x.id !== sid); d.activeSummary = d.summaries[0]?.id; save(id, d); renderMain(); },
  stopSum(){ S.busy.sum?.ctl.abort(); },
  stopSheet(){ S.busy.sheet?.ctl.abort(); },
  print(){ window.print(); },
  explain(v){ const [id, cid] = v.split("|"); openExplain(id, cid); },
  closeExplain(){ S.explain?.ctl?.abort(); S.explain = null; renderSheet(); },
  chatQuick(v){ sendExplain(v); },
  share(v){ const [kind, id] = v.split("|"); createShare(kind, id); },
  nativeShare, closeShare(){ S.share = null; renderMain(); },
  copy(v){ copyText(v); },
  importShare, cancelImport(){ S.importShare = null; history.replaceState(null, "", location.pathname); go("heute"); },
  gen: genStart,
  genStop(){ S.upload.ctl?.abort(); },
  examTab(v){ S.examTab = v; if (v === "duel" && S.duel && ["lobby","result"].includes(S.duel.stage)) startDuelPoll(); renderMain(); },
  examFrom(v){ S.exam = {stage:"setup", scope:v, n:8}; S.examTab = "exam"; go("klausur"); },
  examStart, examSubmit,
  examStop(){ S.exam?.ctl?.abort(); },
  examNew(){ S.exam = {stage:"setup", scope:S.exam?.scope || "all", n:S.exam?.n || 8}; renderMain(); scrollTo(0, 0); },
  examRetry(){ S.exam = {stage:"setup", scope:S.exam.scope, n:S.exam.n}; examStart(); },
  duelCreate: createDuel,
  duelPlay(){ const n = $("#duelName"); if (n) { S.profile.prefs.displayName = n.value.trim().slice(0, 30); saveProfile(); } startPlay(); },
  duelAnswer(v){ duelAnswer(Number(v)); },
  duelLeave(){ stopDuelPoll(); clearInterval(duelTimer); S.duel = {stage:"menu", scope:S.duel?.scope || "all", n:S.duel?.n || 8, error:""}; renderMain(); },
  async duelShare(v){ if (navigator.share) { try { await navigator.share({title:"Quiz-Duell", text:"Spiel mit mir ein Quiz-Duell! Code: " + S.duel.id, url:v}); return; } catch {} } copyText(v); },
  editPrompt(v){ S.promptEdit = v || null; renderMain(); $("#prompts")?.scrollIntoView({block:"start"}); },
  delPrompt(v){ const P = S.profile; P.prompts = P.prompts.filter(p => p.id !== v); addTomb(P.delPrompts, v); if (P.activePromptId === v) P.activePromptId = P.prompts[0].id; S.promptEdit = null; saveProfile(); toast("Prompt gelöscht"); renderMain(); },
  clearKey(){ settings.key = ""; toast("Schlüssel entfernt"); renderMain(); },
  syncNow(){ Sync.full().then(() => toast(Sync.state === "error" ? "Sync fehlgeschlagen" : "Synchronisiert")); },
  async logout(){ await Sync.client?.auth.signOut(); S.auth.msg = ""; toast("Abgemeldet"); render(); },
  reminder(){ reminderIcs($("#remTime")?.value || "18:00"); },
  async install(){ const p = S.installPrompt; if (!p) return; S.installPrompt = null; p.prompt(); try { await p.userChoice; } catch {} renderMain(); },
  export: exportBackup,
  wipe: wipeAll
};

document.addEventListener("click", e => {
  const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
  if (t.dataset.act === "reveal" && e.target.closest("button[data-act]:not([data-act=reveal])")) return;
  const f = ACT[t.dataset.act]; if (f) { e.preventDefault(); f(t.dataset.v, t); }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, id = f.id;
  if (id === "addSubjForm") { const n = $("#newSubjName").value.trim(); if (!n) return; addSubject(n); toast("Fach angelegt"); renderMain(); }
  else if (id === "addCardForm") {
    const d = S.docs[f.dataset.doc], kind = $("#ncKind").value, q = $("#ncQ").value.trim(), a = $("#ncA").value.trim();
    if (!d || !q) return;
    if (kind === "cloze" && !/\{\{.+?\}\}/.test(q)) return toast("Markiere die Lücke mit doppelten geschweiften Klammern: {{so}}.");
    if (kind === "basic" && !a) return toast("Gib eine Antwort ein.");
    d.cards = [...arr(d.cards), newCard(q, a, kind)]; save(f.dataset.doc, d); toast("Karte hinzugefügt"); renderMain();
  }
  else if (id === "editCardForm") {
    const kind = $("#ecKind").value, q = $("#ecQ").value.trim(), a = $("#ecA").value.trim();
    if (!q) return;
    if (kind === "cloze" && !/\{\{.+?\}\}/.test(q)) return toast("Markiere die Lücke mit doppelten geschweiften Klammern: {{so}}.");
    if (kind === "basic" && !a) return toast("Gib eine Antwort ein.");
    editCard(f.dataset.doc, f.dataset.card, {kind, q, a}); S.cardEdit = null; toast("Karte gespeichert"); renderMain();
  }
  else if (id === "resumForm") resummarize(f.dataset.doc, $("#resumPrompt").value);
  else if (id === "sheetForm") makeSheet(f.dataset.sid, [...f.querySelectorAll("input[type=checkbox]:checked")].map(x => x.value), $("#sheetPrompt").value);
  else if (id === "chatForm") { const v = $("#chatIn").value; if (v.trim()) sendExplain(v); }
  else if (id === "joinForm") joinDuel($("#joinCode").value);
  else if (id === "promptForm") {
    const name = $("#pName").value.trim(), text = $("#pText").value.trim(); if (!name || !text) return;
    const P = S.profile, pid = f.dataset.id;
    if (pid) Object.assign(P.prompts.find(p => p.id === pid) || {}, {name, text});
    else { const np = {id:rid("p"), name, text}; P.prompts.push(np); P.activePromptId = np.id; }
    S.promptEdit = null; saveProfile(); toast("Masterprompt gespeichert"); renderMain();
  }
  else if (id === "keyForm") {
    const v = $("#keyIn").value.trim();
    if (v && !v.startsWith("sk-ant-")) return toast("Das sieht nicht wie ein Anthropic-Schlüssel aus (sk-ant-…).");
    settings.key = v; toast(v ? "Schlüssel gespeichert" : "Schlüssel entfernt"); renderMain();
  }
  else if (id === "ytForm") { settings.ytKey = $("#ytIn").value.trim(); toast("Gespeichert"); renderMain(); }
  else if (id === "serverForm") {
    const u = $("#sbUrl").value.trim(), k = $("#sbKey").value.trim();
    if (u && !/^https:\/\/.+/.test(u)) return toast("Die URL muss mit https:// beginnen.");
    settings.sbUrl = u; settings.sbKey = k; Sync.init(); toast(Sync.configured ? "Server verbunden" : "Server-Verbindung entfernt"); render();
  }
  else if (id === "authForm") {
    const mode = e.submitter?.dataset.mode || "login", email = $("#authEmail").value.trim(), pw = $("#authPw").value;
    S.auth = {email, busy:true, msg:""}; renderMain();
    const r = mode === "signup"
      ? await Sync.client.auth.signUp({email, password:pw, options:{emailRedirectTo:location.origin + location.pathname}})
      : await Sync.client.auth.signInWithPassword({email, password:pw});
    S.auth.busy = false;
    if (r.error) S.auth.msg = r.error.message.includes("Invalid login") ? "E-Mail oder Passwort stimmt nicht." : r.error.message.includes("not confirmed") ? "Bestätige zuerst deine E-Mail (Link im Postfach)." : r.error.message;
    else if (mode === "signup" && !r.data.session) S.auth.msg = "Fast geschafft: Bestätige deine E-Mail über den Link in deinem Postfach und melde dich dann an.";
    else { S.auth.msg = ""; toast("Angemeldet"); }
    render();
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "fileIn") { S.upload.files = [...t.files]; S.upload.error = ""; renderMain(); }
  else if (t.id === "importIn" && t.files[0]) importBackup(t.files[0]);
  else if (t.id === "modelSel") { settings.model = t.value; toast("Modell gespeichert"); }
  else if (t.id === "useProxy") { settings.useProxy = t.checked; renderMain(); }
  else if (t.id === "subjSel") { S.upload.subjectId = t.value; renderMain(); }
  else if (t.id === "upPrompt") S.upload.promptId = t.value;
  else if (t.name === "activePrompt") { S.profile.activePromptId = t.value; saveProfile(); renderMain(); }
  else if (t.id === "examDate") { const s = subj(t.dataset.sid); if (s) { s.examDate = t.value; saveProfile(); renderMain(); } }
  else if (t.id === "exScope") S.exam.scope = t.value;
  else if (t.id === "exN") S.exam.n = Number(t.value);
  else if (t.id === "duScope") S.duel.scope = t.value;
  else if (t.id === "duN") S.duel.n = Number(t.value);
  else if (t.id === "newPerDay") { S.profile.prefs.newPerDay = clamp(Number(t.value) || 0, 0, 200); saveProfile(); }
  else if (t.id === "retention") { S.profile.prefs.retention = Number(t.value); saveProfile(); }
  else if (t.id === "impSubj") { S.importShare.subjectId = t.value; renderMain(); }
  else if (t.name && /^q\d+$/.test(t.name) && S.exam) S.exam.answers[Number(t.name.slice(1))] = Number(t.value);
});
document.addEventListener("input", e => {
  const t = e.target;
  if (t.id === "pasteIn") S.upload.text = t.value;
  else if (t.id === "newSubjIn") S.upload.newSubject = t.value;
  else if (t.id === "impNew") S.importShare.newSubject = t.value;
  else if (t.id === "duelName") S.profile.prefs.displayName = t.value;
  else if (t.id === "cardQ") { S.cardQ = t.value; const r = $("#searchRes"); if (r) { r.innerHTML = searchResults(t.value); renderMath(r); } }
  else if (/^qa\d+$/.test(t.id) && S.exam) S.exam.answers[Number(t.id.slice(2))] = t.value;
  else if (t.id === "glossQ") {
    S.glossQ = t.value; const q = t.value.toLowerCase();
    document.querySelectorAll(".gloss .term").forEach(el => { el.hidden = !!q && !el.textContent.toLowerCase().includes(q); });
  }
});
document.addEventListener("dragover", e => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); d.classList.add("over"); } });
document.addEventListener("dragleave", e => { const d = e.target.closest?.("#drop"); if (d) d.classList.remove("over"); });
document.addEventListener("drop", e => { const d = e.target.closest?.("#drop"); if (d) { e.preventDefault(); S.upload.files = [...e.dataTransfer.files]; S.upload.error = ""; renderMain(); } });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && S.explain) return ACT.closeExplain();
  if (S.view !== "review" || !S.review || S.explain || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if ((e.key === " " || e.key === "Enter") && !S.review.shown) { e.preventDefault(); ACT.reveal(); }
  else if (S.review.shown && ["1","2","3","4"].includes(e.key)) grade(Number(e.key) - 1);
  else if ((e.key === "z" || e.key === "Backspace") && arr(S.review.undo).length) { e.preventDefault(); undoGrade(); }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { Sync.incremental(); if (S.view === "heute") renderMain(); } });
addEventListener("online", () => { renderHeader(); Sync.incremental(); });
addEventListener("offline", renderHeader);
addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installPrompt = e; if (S.view === "settings") renderMain(); });

/* ---------- Start ---------- */
(async () => {
  render();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
  try { idb = await openDb(); await loadAll(); S.store = "local"; navigator.storage?.persist?.().catch(() => {}); }
  catch { idb = null; S.store = "memory"; }
  S.ready = true;
  Sync.init();
  if (Sync.client) { try { const {data} = await Sync.client.auth.getSession(); Sync.session = data.session; } catch {} }
  const q = new URLSearchParams(location.search);
  if (q.get("go") && VIEWS[q.get("go")]) { S.view = q.get("go"); history.replaceState(null, "", location.pathname); }
  if (q.get("s")) loadShare(q.get("s"));
  else if (q.get("d")) {
    history.replaceState(null, "", location.pathname);
    S.view = "klausur"; S.examTab = "duel"; S.duel = {stage:"menu", scope:"all", n:8, error:""};
    render(); if (Sync.uid) joinDuel(q.get("d")); else S.duel.error = "Melde dich an, um beim Duell " + q.get("d").toUpperCase() + " mitzuspielen.";
  }
  render();
  if (Sync.uid) Sync.full();
})();
