"use strict";
/* Ansichten: liefern HTML-Strings. Nutzertexte immer mit esc() oder md(). */

const lvl = c => { const b = boxOf(c); let h = '<span class="lvl" aria-label="Stufe ' + (b+1) + ' von 6">'; for (let i = 0; i < 6; i++) h += '<i class="' + (c.reps && i <= b ? "on" : "") + '"></i>'; return h + "</span>"; };
const subjDot = s => '<span class="dot" style="--c:var(--s' + (s ? s.color : 0) + ')"></span>';
const clozeHtml = (q, reveal) => esc(q).replace(/\{\{(.+?)\}\}/g, (_, x) => reveal ? `<mark class="gap on">${x}</mark>` : `<span class="gap">…</span>`);
const cardQ = c => c.kind === "cloze" ? clozeHtml(c.q, false) : esc(c.q);
const cardListQ = c => c.kind === "cloze" ? clozeHtml(c.q, true) : esc(c.q);
const spin = '<span class="spinner" aria-hidden="true"></span>';
const sel = (cond) => cond ? "selected" : "";

function vLoading(){ return '<div class="panel row">' + spin + '<span>Deine Kartei wird geladen…</span></div>'; }
function storeNotice(){ return S.store === "memory" ? '<div class="notice">Dein Browser erlaubt hier keine Speicherung (z. B. privater Modus). Deine Karten gehen beim Schließen verloren.</div>' : ""; }
function aiNotice(){
  return aiReady() ? "" : '<div class="notice">Damit Claude Karten, Zusammenfassungen und Klausuren erstellen kann, richte zuerst den Zugang ein. <button class="link" data-act="nav" data-v="settings">Zu den Einstellungen →</button></div>';
}
function cardEditForm(docId, c){
  return `<form id="editCardForm" data-doc="${esc(docId)}" data-card="${esc(c.id)}" class="panel stack">
    <h3>Karte bearbeiten</h3>
    <label class="f" for="ecKind">Art<select id="ecKind"><option value="basic" ${sel(c.kind !== "cloze")}>Frage und Antwort</option><option value="cloze" ${sel(c.kind === "cloze")}>Lückentext</option></select></label>
    <label class="f" for="ecQ">Frage oder Lückentext<textarea id="ecQ" required maxlength="600" style="min-height:70px">${esc(c.q)}</textarea></label>
    <label class="f" for="ecA">Antwort / Zusatzinfo<textarea id="ecA" maxlength="1500" style="min-height:80px">${esc(c.a)}</textarea></label>
    <div class="row"><button class="primary" type="submit">Speichern</button><button type="button" data-act="cancelEdit">Abbrechen</button></div></form>`;
}
function searchResults(q){
  if (String(q || "").trim().length < 2) return "";
  const hits = searchCards(q);
  if (!hits.length) return '<p class="muted small">Keine Karte gefunden.</p>';
  return `<p class="muted small">${hits.length === 50 ? "Die ersten 50 Treffer" : hits.length + (hits.length === 1 ? " Treffer" : " Treffer")}</p><div class="list">${hits.map(x => `<button class="item" data-act="openDoc" data-v="${esc(x.docId)}"><span class="grow"><span class="t">${cardListQ(x.c)}</span><br><span class="s">${esc(x.c.a.slice(0, 140))}${x.c.a.length > 140 ? "…" : ""}</span><br><span class="s">${esc(S.docs[x.docId]?.title || "")}</span></span></button>`).join("")}</div>`;
}
function examItem(x){
  const inner = `<span class="grow"><span class="t">${esc(x.label)}</span><br><span class="s">${fmtDate(x.date)}${x.detail && S.examDetails[x.id] ? " · Aufgaben ansehen" : ""}</span></span><span class="pill num">${x.pct} %</span>`;
  return x.detail && S.examDetails[x.id] ? `<button class="item" data-act="examOpen" data-v="${esc(x.id)}">${inner}</button>` : `<div class="item">${inner}</div>`;
}
function docItem(id, d){
  const s = subj(d.subjectId), due = arr(d.cards).filter(isDue).length, fresh = arr(d.cards).filter(isNew).length;
  return `<button class="item" data-act="openDoc" data-v="${esc(id)}">${subjDot(s)}<span class="grow"><span class="t">${esc(d.title)}</span><br><span class="s">${esc(s?.name || "Ohne Fach")} · ${arr(d.cards).length} Karten${fresh ? " · " + fresh + " neu" : ""} · ${fmtDate(d.createdAt)}</span></span>${due ? `<span class="pill due num">${due} fällig</span>` : ""}</button>`;
}

/* ---------- Heute ---------- */
function vHeute(){
  if (!S.ready) return vLoading();
  const st = stats(), pt = planTotals(), todo = pt.due + pt.fresh;
  const dateStr = new Date().toLocaleDateString("de-DE", {weekday:"long", day:"numeric", month:"long"});
  if (!Object.keys(S.docs).length) return storeNotice() + aiNotice() + `
    <div><p class="eyebrow">${esc(dateStr)}</p><h1>Dein Karteikasten ist noch leer</h1></div>
    <div class="paper empty">
      <h2 style="margin-top:4px">So funktioniert's</h2>
      <p>Lade ein Skript, Folien als PDF oder Fotos deiner Mitschrift hoch. Claude erstellt daraus Karteikarten, eine Zusammenfassung nach deinem Masterprompt und passende Erklärvideos. Danach plant die App, was du jeden Tag lernst.</p>
      <div class="row"><button class="primary" data-act="nav" data-v="upload">Erstes Dokument hochladen</button><button data-act="example">Beispiel ansehen</button></div>
    </div>`;
  const plans = pt.plan.filter(p => p.due || p.quota || examActive(p.s));
  const recent = Object.entries(S.docs).sort((a, b) => b[1].createdAt - a[1].createdAt).slice(0, 4);
  return storeNotice() + `
    <div><p class="eyebrow">${esc(dateStr)}</p><h1>${todo ? "Heute stehen Karten an" : "Für heute alles gelernt"}</h1></div>
    <div class="paper hero hero-main">
      <div class="row between"><span class="eyebrow">Heute im Plan</span><span class="eyebrow num">${st.todayN} gelernt</span></div>
      <div class="row between" style="align-items:flex-end">
        <div><div class="big num">${todo}</div><p class="muted">${pt.due} Wiederholungen · ${pt.fresh} neue Karten</p></div>
        <button class="primary" data-act="review" data-v="all" ${todo ? "" : "disabled"}>Jetzt lernen</button>
      </div>
      ${todo ? "" : '<div class="row"><button data-act="reviewAll" data-v="all">Alle Karten üben</button>' + (st.weak ? `<button data-act="reviewWeak" data-v="all">Schwachstellen üben (${st.weak})</button>` : "") + "</div>"}
    </div>
    <div class="statrow">
      <div class="stat"><b>${st.streak}</b><span>${st.streak === 1 ? "Tag" : "Tage"} in Folge</span></div>
      <div class="stat"><b>${st.total}</b><span>Karten gesamt</span></div>
      <div class="stat"><b>${st.total ? Math.round(st.mastered / st.total * 100) : 0} %</b><span>sicher gelernt</span></div>
    </div>
    ${plans.length ? `<section class="stack"><h2>Lernplan</h2><div class="list">${plans.map(p => `<button class="item" data-act="openSubj" data-v="${esc(p.s.id)}">${subjDot(p.s)}<span class="grow"><span class="t">${esc(p.s.name)}</span><br><span class="s">${p.due} Wiederholungen · ${p.quota} neu${p.perDay != null ? " · Plan: " + p.perDay + " neue pro Tag" : ""}</span></span>${examActive(p.s) ? `<span class="pill ${p.left <= 7 ? "due" : ""}">${p.left === 0 ? "Prüfung heute" : "Prüfung in " + p.left + " T"}</span>` : ""}</button>`).join("")}</div></section>` : ""}
    <section class="stack"><div class="row between"><h2>Zuletzt hochgeladen</h2><button class="ghost" data-act="nav" data-v="faecher">Alle Fächer</button></div>
    <div class="list">${recent.map(([id, d]) => docItem(id, d)).join("")}</div></section>`;
}

/* ---------- Fächer ---------- */
function vFaecher(){
  if (!S.ready) return vLoading();
  if (S.sel.sheet && S.sel.subject) { const sh = arr(subj(S.sel.subject)?.sheets).find(x => x.id === S.sel.sheet); if (sh) return vSheet(S.sel.subject, sh); }
  if (S.sel.doc && S.docs[S.sel.doc]) return vDoc(S.sel.doc);
  if (S.sel.subject && subj(S.sel.subject)) return vSubject(S.sel.subject);
  const subs = S.profile.subjects;
  return storeNotice() + `<div><p class="eyebrow">Semester</p><h1>Deine Fächer</h1></div>
    ${Object.keys(S.docs).length ? `<div class="panel stack"><label class="f" for="cardQ">Karten durchsuchen<input id="cardQ" type="search" placeholder="Begriff, Formel, Frage…" value="${esc(S.cardQ)}" autocomplete="off"></label><div id="searchRes" class="stack">${searchResults(S.cardQ)}</div></div>` : ""}
    ${subs.length ? `<div class="list">${subs.map(s => {
      const docs = docsOf(s.id), cards = allCards((id, d) => d.subjectId === s.id), due = cards.filter(x => isDue(x.c)).length;
      return `<button class="item" data-act="openSubj" data-v="${esc(s.id)}">${subjDot(s)}<span class="grow"><span class="t">${esc(s.name)}</span><br><span class="s">${docs.length} ${docs.length === 1 ? "Dokument" : "Dokumente"} · ${cards.length} Karten${examActive(s) ? " · Prüfung in " + daysUntil(s.examDate) + " T" : ""}</span></span>${due ? `<span class="pill due num">${due} fällig</span>` : ""}</button>`;
    }).join("")}</div>` : `<div class="panel"><p>Noch keine Fächer. Lege eins an oder lade direkt ein Dokument hoch.</p></div>`}
    <form id="addSubjForm" class="panel stack"><label class="f" for="newSubjName">Neues Fach</label><div class="row nowrap"><input id="newSubjName" placeholder="z. B. Makroökonomie" maxlength="60" autocomplete="off"><button class="primary" type="submit">Anlegen</button></div></form>`;
}
function sharePanel(target){
  if (!S.share || S.share.target !== target) return "";
  return `<div class="panel stack"><h3>Link zum Teilen</h3><p class="muted small">Wer den Link öffnet, kann die Karten in die eigene Kartei übernehmen.</p>
    <input id="shareUrl" readonly value="${esc(S.share.url)}"><div class="row"><button class="primary" data-act="nativeShare">Teilen</button><button data-act="copy" data-v="${esc(S.share.url)}">Link kopieren</button><button class="ghost" data-act="closeShare">Schließen</button></div></div>`;
}
function vSubject(sid){
  const s = subj(sid), docs = docsOf(sid), cards = allCards((id, d) => d.subjectId === sid);
  const due = cards.filter(x => isDue(x.c)).length, weak = cards.filter(x => isWeak(x.c)).length;
  const plan = planToday().find(p => p.s.id === sid);
  const conf = S.confirm === "subj:" + sid, left = examActive(s) ? daysUntil(s.examDate) : -1;
  const gq = (S.glossQ || "").toLowerCase();
  const gl = arr(s.glossary).filter(t => !gq || (t.term + " " + t.def).toLowerCase().includes(gq));
  const sheetBusy = S.busy.sheet && S.busy.sheet.sid === sid;
  return `<button class="ghost back noprint" data-act="back">← Alle Fächer</button>
    <div class="row nowrap">${subjDot(s)}<h1 style="min-width:0;overflow-wrap:anywhere">${esc(s.name)}</h1></div>
    <div class="actions noprint"><button class="primary" data-act="review" data-v="s:${esc(sid)}" ${due || plan?.quota ? "" : "disabled"}>Lernen (${due + (plan?.quota || 0)})</button><button data-act="reviewAll" data-v="s:${esc(sid)}" ${cards.length ? "" : "disabled"}>Alle üben</button><button data-act="examFrom" data-v="s:${esc(sid)}" ${docs.length ? "" : "disabled"}>Übungsklausur</button><button data-act="share" data-v="subj|${esc(sid)}" ${docs.length ? "" : "disabled"}>${S.busy.share === sid ? spin : ""}Teilen</button></div>
    ${sharePanel(sid)}
    <div class="panel stack"><label class="f" for="examDate">Prüfungstermin</label><input type="date" id="examDate" data-sid="${esc(sid)}" value="${esc(s.examDate || "")}">
      <p class="muted small">${left >= 0 ? `Noch ${left} Tage. ${plan.fresh} Karten sind noch neu. Der Plan führt täglich ${plan.perDay} neue ein, sodass du die letzten zwei Tage nur wiederholst.` : `Ohne Termin lernst du bis zu ${S.profile.prefs.newPerDay} neue Karten pro Tag (über alle Fächer, änderbar in den Einstellungen).`}</p></div>
    <section class="stack"><div class="row between"><h2>Dokumente</h2><button class="ghost noprint" data-act="uploadTo" data-v="${esc(sid)}">+ Hochladen</button></div>
    ${docs.length ? `<div class="list">${docs.map(([id, d]) => docItem(id, d)).join("")}</div>` : '<div class="panel"><p class="muted">Noch keine Dokumente in diesem Fach.</p></div>'}</section>

    ${docs.length ? `<section class="stack"><h2>Klausur-Lernzettel</h2>
      ${arr(s.sheets).length ? `<div class="list">${s.sheets.map(x => `<button class="item" data-act="openSheet" data-v="${esc(x.id)}"><span class="grow"><span class="t">${esc(x.title)}</span><br><span class="s">${x.docIds.length} Dokumente${x.promptName ? " · " + esc(x.promptName) : ""}</span></span></button>`).join("")}</div>` : ""}
      ${sheetBusy ? `<div class="paper hero"><div class="row"><span class="eyebrow">Lernzettel entsteht</span></div><div class="md" id="sheetLive">${S.busy.sheet.text ? md(S.busy.sheet.text) : '<p class="row">' + spin + " Claude fasst deine Dokumente zusammen…</p>"}</div><button data-act="stopSheet">Abbrechen</button></div>` : `
      <form id="sheetForm" data-sid="${esc(sid)}" class="panel stack noprint"><p class="muted small">Fasst mehrere Dokumente zu einem gegliederten Lernzettel zusammen.</p>
        <fieldset class="checks"><legend class="f">Dokumente</legend>${docs.map(([id, d]) => `<label class="check" for="sh-${esc(id)}"><input type="checkbox" id="sh-${esc(id)}" value="${esc(id)}" checked><span>${esc(d.title)}</span></label>`).join("")}</fieldset>
        <label class="f" for="sheetPrompt">Masterprompt (optional)<select id="sheetPrompt"><option value="">Keiner</option>${S.profile.prompts.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>
        <button class="primary" type="submit">Lernzettel erstellen</button></form>`}
    </section>` : ""}

    <section class="stack"><div class="row between"><h2>Glossar ${arr(s.glossary).length ? `<span class="muted num" style="font-weight:400">${s.glossary.length}</span>` : ""}</h2><button class="ghost noprint" data-act="gloss" data-v="${esc(sid)}" ${S.busy.gloss ? "disabled" : ""}>${S.busy.gloss === sid ? spin + " Erstelle…" : arr(s.glossary).length ? "Neu erstellen" : "Glossar erstellen"}</button></div>
      ${arr(s.glossary).length ? `<input id="glossQ" class="noprint" placeholder="Begriff suchen…" value="${esc(S.glossQ || "")}" autocomplete="off"><div class="list gloss">${gl.map(t => `<div class="term"><b>${esc(t.term)}</b><span>${esc(t.def)}</span></div>`).join("") || '<div class="term"><span class="muted">Kein Treffer.</span></div>'}</div>` : '<p class="muted small">Sammelt alle Fachbegriffe aus deinen Dokumenten mit kurzer Definition.</p>'}
    </section>

    <section class="stack noprint"><div class="row between"><h2>Schwachstellen</h2><button class="ghost" data-act="weak" data-v="${esc(sid)}" ${S.busy.weak ? "disabled" : ""}>${S.busy.weak === sid ? spin + " Analysiere…" : "Analysieren"}</button></div>
      ${s.weak && arr(s.weak.themes).length ? `<div class="list">${s.weak.themes.map(t => `<div class="term"><b>${esc(t.name)}</b><span>${esc(t.why)}</span><span class="tip"><strong>Tipp:</strong> ${esc(t.tip)}</span></div>`).join("")}</div><p class="muted small">Analyse vom ${fmtDate(s.weak.date)}. Die neuen Übungskarten liegen im Dokument „Gezielte Übung: Schwachstellen“.</p>` : `<p class="muted small">${weak ? weak + " Karten beantwortest du oft falsch. Claude findet die Lücken dahinter und erstellt gezielte Übungskarten." : "Sobald du ein paar Tage gelernt hast, zeigt sich hier, wo es hakt."}</p>`}
      ${weak ? `<button data-act="reviewWeak" data-v="s:${esc(sid)}">Schwache Karten üben (${weak})</button>` : ""}
    </section>
    <div class="row noprint">${conf ? `<span>Fach mit ${docs.length} Dokumenten löschen?</span><button class="danger" data-act="delSubj" data-v="${esc(sid)}">Ja, löschen</button><button data-act="cancel">Abbrechen</button>` : `<button class="danger" data-act="confirm" data-v="subj:${esc(sid)}">Fach löschen</button>`}</div>`;
}
function vSheet(sid, sh){
  const conf = S.confirm === "sheet:" + sh.id;
  return `<button class="ghost back noprint" data-act="openSubj" data-v="${esc(sid)}">← ${esc(subj(sid)?.name || "Fach")}</button>
    <div class="stack" style="gap:6px"><p class="eyebrow">${esc(subj(sid)?.name || "")} · ${sh.docIds.length} Dokumente</p><h1>${esc(sh.title)}</h1></div>
    <div class="row noprint"><button data-act="print">Drucken / als PDF</button>${conf ? `<button class="danger" data-act="delSheet" data-v="${esc(sid)}|${esc(sh.id)}">Ja, löschen</button><button data-act="cancel">Abbrechen</button>` : `<button class="danger" data-act="confirm" data-v="sheet:${esc(sh.id)}">Löschen</button>`}</div>
    <article class="paper sheet md">${md(sh.md)}</article>`;
}
function mindNode(n, depth){
  const kids = arr(n.children);
  return `<li><span class="mn d${depth}">${esc(n.label)}</span>${kids.length && depth < 3 ? `<ul>${kids.map(k => mindNode(k, depth + 1)).join("")}</ul>` : ""}</li>`;
}
function vDoc(id){
  const d = S.docs[id], s = subj(d.subjectId), cards = arr(d.cards), due = cards.filter(isDue).length, fresh = cards.filter(isNew).length;
  const conf = S.confirm === "doc:" + id;
  const sum = d.summaries.find(x => x.id === d.activeSummary) || d.summaries[0];
  const sumBusy = S.busy.sum && S.busy.sum.docId === id;
  const vids = arr(d.videoResults).length ? d.videoResults : null;
  return `<button class="ghost back noprint" data-act="openSubj" data-v="${esc(d.subjectId)}">← ${esc(s?.name || "Fach")}</button>
    <div class="stack" style="gap:6px"><p class="eyebrow">${esc(d.fileName)} · ${fmtDate(d.createdAt)}${d.parts > 1 ? " · " + d.parts + " Teile" : ""}</p><h1>${esc(d.title)}</h1></div>
    ${arr(d.warnings).length ? `<div class="notice" role="status">${d.warnings.map(esc).join("<br>")}</div>` : ""}
    <div class="actions noprint"><button class="primary" data-act="review" data-v="d:${esc(id)}" ${due || fresh ? "" : "disabled"}>Lernen (${due + Math.min(fresh, 15)})</button><button data-act="reviewAll" data-v="d:${esc(id)}">Alle ${cards.length} üben</button><button data-act="examFrom" data-v="d:${esc(id)}">Übungsklausur</button><button data-act="share" data-v="doc|${esc(id)}">${S.busy.share === id ? spin : ""}Teilen</button><button data-act="print">Drucken / PDF</button></div>
    ${sharePanel(id)}

    <section class="stack"><h2>Zusammenfassung</h2>
      ${d.summaries.length > 1 ? `<div class="seg noprint" role="tablist">${d.summaries.map(x => `<button role="tab" aria-selected="${x.id === sum?.id}" class="${x.id === sum?.id ? "on" : ""}" data-act="pickSum" data-v="${esc(id)}|${esc(x.id)}">${esc(x.promptName)} <small>${fmtDate(x.createdAt)}</small></button>`).join("")}</div>` : ""}
      ${sumBusy ? `<div class="paper sheet md" id="sumLive">${S.busy.sum.text ? md(S.busy.sum.text) : '<p class="row">' + spin + " Claude schreibt die Zusammenfassung…</p>"}</div><button class="noprint" data-act="stopSum">Abbrechen</button>`
        : sum ? `<article class="paper sheet md">${md(sum.md)}</article>` : '<p class="muted">Noch keine Zusammenfassung.</p>'}
      ${arr(d.topics).length ? `<div class="tags">${d.topics.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      ${sumBusy ? "" : `<form id="resumForm" data-doc="${esc(id)}" class="panel stack noprint"><label class="f" for="resumPrompt">Neue Zusammenfassung mit Masterprompt<select id="resumPrompt">${S.profile.prompts.map(p => `<option value="${esc(p.id)}" ${sel(p.id === S.profile.activePromptId)}>${esc(p.name)}</option>`).join("")}</select></label><div class="row"><button type="submit">Erstellen</button>${sum && d.summaries.length > 1 ? `<button type="button" class="ghost" data-act="delSum" data-v="${esc(id)}|${esc(sum.id)}">Diese Version löschen</button>` : ""}<button type="button" class="ghost" data-act="nav" data-v="settings">Prompts verwalten</button></div></form>`}
    </section>

    <section class="stack"><div class="row between"><h2>Mindmap</h2><button class="ghost noprint" data-act="mind" data-v="${esc(id)}" ${S.busy.mind ? "disabled" : ""}>${S.busy.mind === id ? spin + " Erstelle…" : d.mindmap ? "Neu erstellen" : "Mindmap erstellen"}</button></div>
      ${d.mindmap ? `<div class="mind"><div class="mc">${esc(d.mindmap.center)}</div><ul class="mb">${arr(d.mindmap.branches).map((b, i) => `<li style="--c:var(--s${i % SUBJ_COLORS})"><span class="mn d1">${esc(b.label)}</span>${arr(b.children).length ? `<ul>${b.children.map(k => mindNode(k, 2)).join("")}</ul>` : ""}</li>`).join("")}</ul></div>` : '<p class="muted small">Zeigt die Struktur des Dokuments auf einen Blick.</p>'}
    </section>

    ${arr(d.videos).length ? `<section class="stack noprint"><div class="row between"><h2>Erklärvideos</h2>${settings.ytKey ? `<button class="ghost" data-act="videos" data-v="${esc(id)}" ${S.busy.vid ? "disabled" : ""}>${S.busy.vid === id ? spin + " Lade…" : vids ? "Aktualisieren" : "Videos laden"}</button>` : ""}</div>
      ${vids ? vids.map(g => `<div class="stack" style="gap:8px"><h3>${esc(g.title)}</h3>${g.why ? `<p class="muted small">${esc(g.why)}</p>` : ""}<div class="vgrid">${g.items.map(v => `<button class="vthumb" data-act="playVid" data-v="${esc(v.id)}" aria-label="${esc(v.title)} abspielen"><img src="${esc(v.thumb)}" alt="" loading="lazy"><span class="vt">${esc(v.title)}</span><span class="vc">${esc(v.channel)}</span></button>`).join("") || '<p class="muted small">Keine Treffer.</p>'}</div></div>`).join("")
        : `${settings.ytKey ? "" : '<p class="muted small">Öffnet eine YouTube-Suche. Mit einem YouTube-API-Schlüssel (Einstellungen) siehst du die Videos direkt hier.</p>'}<div class="list">${d.videos.map(v => `<a class="vid" href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.query)}" target="_blank" rel="noopener"><span class="play" aria-hidden="true"></span><span style="min-width:0"><b>${esc(v.title)}</b><br><span class="muted small">${esc(v.why)}</span><br><span class="mono small">„${esc(v.query)}“</span></span></a>`).join("")}</div>`}
    </section>` : ""}

    <section class="stack"><div class="row between"><h2>Karteikarten <span class="muted num" style="font-weight:400">${cards.length}</span></h2>${d.text ? `<button class="ghost noprint" data-act="more" data-v="${esc(id)}" ${S.busy.more ? "disabled" : ""}>${S.busy.more === id ? spin + " Erstelle…" : "+ 10 weitere"}</button>` : ""}</div>
    <div class="list">${cards.map(c => S.cardEdit === id + "|" + c.id ? `<div class="cardrow editing">${cardEditForm(id, c)}</div>` : `<div class="cardrow"><span class="cq">${c.kind === "cloze" ? '<span class="kind">Lücke</span> ' : ""}${cardListQ(c)}</span><span>${lvl(c)}</span><span class="ca">${esc(c.a)}${c.img ? `<img data-img="${esc(c.img)}" alt="Abbildung aus dem Dokument" hidden class="cimg">` : ""}</span><span class="row nowrap noprint" style="gap:0;align-self:start"><button class="ghost mini" data-act="explain" data-v="${esc(id)}|${esc(c.id)}" aria-label="Erklären">?</button><button class="ghost mini" data-act="editCard" data-v="${esc(id)}|${esc(c.id)}" aria-label="Karte bearbeiten">✎</button><button class="ghost mini" data-act="delCard" data-v="${esc(id)}|${esc(c.id)}" aria-label="Karte löschen">×</button></span></div>`).join("")}</div>
    <form id="addCardForm" data-doc="${esc(id)}" class="panel stack noprint"><h3>Eigene Karte hinzufügen</h3>
      <label class="f" for="ncKind">Art<select id="ncKind"><option value="basic">Frage und Antwort</option><option value="cloze">Lückentext</option></select></label>
      <label class="f" for="ncQ">Frage oder Lückentext<input id="ncQ" required maxlength="600" placeholder="Lücken so: Die {{Glykolyse}} läuft im Cytoplasma."></label>
      <label class="f" for="ncA">Antwort / Zusatzinfo<textarea id="ncA" maxlength="1500" style="min-height:80px" placeholder="Formeln mit $...$, z. B. $a^2+b^2=c^2$"></textarea></label>
      <button type="submit">Karte hinzufügen</button></form></section>
    <div class="row noprint">${conf ? `<span>Dokument und alle Karten löschen?</span><button class="danger" data-act="delDoc" data-v="${esc(id)}">Ja, löschen</button><button data-act="cancel">Abbrechen</button>` : `<button class="danger" data-act="confirm" data-v="doc:${esc(id)}">Dokument löschen</button>`}</div>`;
}

/* ---------- Hochladen ---------- */
function vUpload(){
  const U = S.upload, subs = S.profile.subjects;
  const s = U.subjectId || subs[0]?.id || "__new", showNew = !subs.length || s === "__new";
  const pid = U.promptId || S.profile.activePromptId;
  if (U.busy) return `<div><p class="eyebrow">Neues Material</p><h1>Karteikarten entstehen</h1></div>
    <div class="paper hero"><div class="row"><span class="eyebrow">${esc(U.files[0]?.name || "Eingefügter Text")}</span></div>
    <div class="row nowrap">${spin}<span id="genStage">${esc(U.stage)}</span></div>
    <p class="muted">Bei langen Skripten kann das ein bis zwei Minuten dauern.</p><button data-act="genStop">Abbrechen</button></div>`;
  return `<div><p class="eyebrow">Neues Material</p><h1>Dokument hochladen</h1></div>
    ${aiNotice()}
    ${U.error ? `<div class="notice bad" role="alert">${esc(U.error)}</div>` : ""}
    <label class="drop" id="drop" for="fileIn">
      <input type="file" id="fileIn" multiple accept=".pdf,.pptx,.docx,.txt,.md,.tex,image/*">
      <h3>${U.files.length ? esc(U.files.map(f => f.name).join(", ")) : "Datei auswählen"}</h3>
      <span class="muted small">${U.files.length ? "Tippen, um andere Dateien zu wählen" : "PDF, PowerPoint, Word, Text oder Fotos deiner Mitschrift"}</span>
    </label>
    <label class="f" for="pasteIn">Oder Text einfügen<textarea id="pasteIn" placeholder="Vorlesungsnotizen, Abschnitt aus dem Skript…">${esc(U.text)}</textarea></label>
    <label class="f" for="subjSel">Fach<select id="subjSel">${subs.map(x => `<option value="${esc(x.id)}" ${sel(x.id === s)}>${esc(x.name)}</option>`).join("")}<option value="__new" ${sel(showNew)}>+ Neues Fach…</option></select></label>
    ${showNew ? `<label class="f" for="newSubjIn">Name des neuen Fachs<input id="newSubjIn" value="${esc(U.newSubject)}" placeholder="z. B. Organische Chemie" maxlength="60"></label>` : ""}
    <label class="f" for="upPrompt">Masterprompt für die Zusammenfassung<select id="upPrompt">${S.profile.prompts.map(p => `<option value="${esc(p.id)}" ${sel(p.id === pid)}>${esc(p.name)}</option>`).join("")}</select></label>
    <button class="primary block" data-act="gen">Karteikarten erstellen</button>
    <p class="muted small">Du bekommst Frage- und Lückentext-Karten, Abbildungen aus den Folien, eine Zusammenfassung und Videovorschläge. Lange Skripte verarbeitet die App automatisch in mehreren Teilen (bis etwa 200 Seiten Fließtext).</p>`;
}

/* ---------- Abfrage ---------- */
function vReview(){
  const R = S.review, cur = curCard();
  if (!R) { S.view = "heute"; return vHeute(); }
  if (!cur) {
    const more = planTotals();
    return `<div><p class="eyebrow">Geschafft</p><h1>${R.done} ${R.done === 1 ? "Karte" : "Karten"} gelernt</h1></div>
      <div class="statrow"><div class="stat"><b>${R.counts[0]}</b><span>Nochmal</span></div><div class="stat"><b>${R.counts[1] + R.counts[2]}</b><span>Gewusst</span></div><div class="stat"><b>${R.counts[3]}</b><span>Leicht</span></div></div>
      <div class="row"><button class="primary" data-act="endReview">Zur Übersicht</button>${arr(R.undo).length ? '<button class="ghost" data-act="undo">↶ Letzte Bewertung zurücknehmen</button>' : ""}${more.due + more.fresh ? `<button data-act="review" data-v="all">Weiter lernen (${more.due + more.fresh})</button>` : ""}</div>`;
  }
  const {d, c} = cur, s = subj(d.subjectId);
  const pct = Math.round(R.done / R.total * 100), lbl = ["Nochmal","Schwer","Gut","Leicht"];
  const tag = isNew(c) ? '<span class="pill">neu</span>' : lvl(c);
  const editing = S.cardEdit === cur.it.docId + "|" + c.id;
  return `<div class="row between"><button class="ghost back" data-act="endReview">← Beenden</button><span class="row nowrap">${arr(R.undo).length ? '<button class="ghost mini" data-act="undo" title="Taste Z">↶ Rückgängig</button>' : ""}<span class="eyebrow num">${R.done} / ${R.total}</span></span></div>
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="review">
      <div class="paper fc" data-act="reveal" role="button" tabindex="0" aria-live="polite">
        <span class="head"><span class="row nowrap" style="gap:8px;min-width:0">${subjDot(s)}<span class="eyebrow ellip">${esc(d.title)}</span></span>${tag}</span>
        <span class="qtext">${c.kind === "cloze" ? clozeHtml(c.q, R.shown) : esc(c.q)}</span>
        ${R.shown ? `${c.a ? `<span class="atext">${esc(c.a)}</span>` : ""}${c.img ? `<img data-img="${esc(c.img)}" alt="Abbildung aus dem Dokument" hidden class="cimg">` : ""}` : `<span class="hint">${c.kind === "cloze" ? "Was gehört in die Lücken? Tippe auf die Karte." : "Überleg dir die Antwort, dann tippe auf die Karte."}</span>`}
      </div>
      ${editing ? cardEditForm(cur.it.docId, c) : R.shown ? `<div class="grades">${[0,1,2,3].map(g => { const n = FSRS.next(c, g + 1); return `<button class="g${g}" data-act="grade" data-v="${g}">${lbl[g]}<small>${fmtDays(n.days)}</small></button>`; }).join("")}</div>
        <div class="row"><button class="ghost" data-act="explain" data-v="${esc(cur.it.docId)}|${esc(c.id)}">Erklär mir das</button><button class="ghost" data-act="editCard" data-v="${esc(cur.it.docId)}|${esc(c.id)}">Karte bearbeiten</button></div>` : `<button class="primary block" data-act="reveal">Antwort zeigen</button>`}
    </div>`;
}

/* ---------- Klausur & Duell ---------- */
function scopeOptions(cur){
  let h = `<option value="all" ${sel(cur === "all")}>Alle Fächer</option>`;
  for (const s of S.profile.subjects) {
    const docs = docsOf(s.id); if (!docs.length) continue;
    h += `<optgroup label="${esc(s.name)}"><option value="s:${esc(s.id)}" ${sel(cur === "s:" + s.id)}>Ganzes Fach: ${esc(s.name)}</option>${docs.map(([id, d]) => `<option value="d:${esc(id)}" ${sel(cur === "d:" + id)}>${esc(d.title)}</option>`).join("")}</optgroup>`;
  }
  return h;
}
function vKlausur(){
  if (!S.ready) return vLoading();
  const tabs = `<div class="seg" role="tablist"><button role="tab" aria-selected="${S.examTab === "exam"}" class="${S.examTab === "exam" ? "on" : ""}" data-act="examTab" data-v="exam">Übungsklausur</button><button role="tab" aria-selected="${S.examTab === "duel"}" class="${S.examTab === "duel" ? "on" : ""}" data-act="examTab" data-v="duel">Quiz-Duell</button></div>`;
  if (!Object.keys(S.docs).length && S.examTab === "exam") return `<div><p class="eyebrow">Prüfungsvorbereitung</p><h1>Klausur</h1></div>${tabs}<div class="panel stack"><p>Sobald du Dokumente hochgeladen hast, erstellt Claude daraus Klausuren und Duelle.</p><button class="primary" data-act="nav" data-v="upload">Dokument hochladen</button></div>`;
  return S.examTab === "duel" ? vDuel(tabs) : vExam(tabs);
}
function vExam(tabs){
  const E = S.exam || (S.exam = {stage:"setup", scope:"all", n:8});
  if (E.stage === "setup") return `<div><p class="eyebrow">Prüfungsvorbereitung</p><h1>Klausur</h1></div>${tabs}
    ${aiNotice()}${E.error ? `<div class="notice bad" role="alert">${esc(E.error)}</div>` : ""}
    <div class="panel stack">
      <label class="f" for="exScope">Stoff<select id="exScope">${scopeOptions(E.scope)}</select></label>
      <label class="f" for="exN">Anzahl Aufgaben<select id="exN">${[5,8,12,16].map(n => `<option ${sel(n === E.n)}>${n}</option>`).join("")}</select></label>
      <button class="primary" data-act="examStart">Klausur erstellen</button>
      <p class="muted small">Etwa 60 % Multiple Choice, 40 % offene Aufgaben. Offene Antworten bewertet Claude mit Punkten und Feedback.</p>
    </div>
    ${arr(S.profile.exams).length ? `<section class="stack"><h2>Letzte Ergebnisse</h2><div class="list">${S.profile.exams.slice(0, 8).map(examItem).join("")}</div></section>` : ""}`;
  if (E.stage === "loading" || E.stage === "grading") return `<div><p class="eyebrow">${esc(scopeLabel(E.scope))}</p><h1>${E.stage === "loading" ? "Klausur wird erstellt" : "Antworten werden korrigiert"}</h1></div>
    <div class="paper hero"><div class="row"><span class="eyebrow">Bitte warten</span></div><div class="row nowrap">${spin}<span>${E.stage === "loading" ? "Claude stellt " + E.n + " Aufgaben aus deinem Material zusammen…" : "Claude vergleicht deine Antworten mit den Musterlösungen…"}</span></div><button data-act="examStop">Abbrechen</button></div>`;
  const done = E.stage === "done", max = E.questions.reduce((s, q) => s + q.points, 0);
  return `<div class="row between"><button class="ghost back" data-act="examNew">← Neue Klausur</button><span class="eyebrow">${esc(scopeLabel(E.scope))}</span></div>
    ${done ? `<div class="paper hero"><div class="row"><span class="eyebrow">${E.past ? "Ergebnis vom " + fmtDate(E.past) : "Ergebnis"}</span></div><div class="row between" style="align-items:flex-end"><div><div class="score num">${E.pct} %</div><p class="muted num">${E.results.reduce((s, r) => s + r.score, 0).toLocaleString("de-DE")} von ${max} Punkten</p></div><span class="pill ${E.pct >= 50 ? "" : "due"}">${E.pct >= 85 ? "Sehr gut" : E.pct >= 65 ? "Gut" : E.pct >= 50 ? "Bestanden" : "Noch üben"}</span></div></div>` : `<h1>${E.questions.length} Aufgaben</h1>`}
    <div class="list">${E.questions.map((q, i) => {
      const r = done ? E.results[i] : null;
      const head = `<div class="row between nowrap" style="align-items:flex-start"><b style="min-width:0;overflow-wrap:anywhere">${i + 1}. ${esc(q.q)}</b><span class="pill num">${done ? r.score.toLocaleString("de-DE") + "/" : ""}${q.points} P</span></div>`;
      if (q.type === "mc") return `<div class="q">${head}${q.options.map((o, j) => {
        const cls = done ? (j === q.correct ? "right" : E.answers[i] === j ? "wrong" : "") : "";
        return `<label class="opt ${cls}" for="q${i}o${j}"><input type="radio" name="q${i}" id="q${i}o${j}" value="${j}" ${E.answers[i] === j ? "checked" : ""} ${done ? "disabled" : ""}><span>${esc(o)}</span></label>`;
      }).join("")}${done && q.explain ? `<div class="fb">${esc(q.explain)}</div>` : ""}</div>`;
      return `<div class="q">${head}<textarea id="qa${i}" ${done ? "disabled" : ""} placeholder="Deine Antwort…">${esc(E.answers[i] || "")}</textarea>${done ? `${r.feedback ? `<div class="fb">${esc(r.feedback)}</div>` : ""}<div class="fb"><span class="eyebrow">Musterlösung</span><br>${esc(q.model)}</div>` : ""}</div>`;
    }).join("")}</div>
    ${done ? `<div class="row"><button class="primary" data-act="examNew">Neue Klausur</button><button data-act="examRetry">Gleicher Stoff, neue Aufgaben</button></div>` : `<button class="primary block" data-act="examSubmit">Abgeben und korrigieren</button>`}`;
}
function leaderboard(D){
  const ps = arr(D.players);
  if (!ps.length) return '<p class="muted small">Noch hat niemand gespielt.</p>';
  return `<div class="list">${ps.map((p, i) => `<div class="item"><span class="rank num">${i + 1}</span><span class="grow"><span class="t">${esc(p.name)}${p.user_id === Sync.uid ? " (du)" : ""}</span><br><span class="s">${p.finished ? p.correct + " richtig" : "spielt gerade"}</span></span><span class="pill num">${p.score}</span></div>`).join("")}</div>`;
}
function vDuel(tabs){
  const D = S.duel || (S.duel = {stage:"menu", scope:"all", n:8, error:""});
  const head = `<div><p class="eyebrow">Mit Kommilitonen</p><h1>Quiz-Duell</h1></div>${tabs}`;
  if (!Sync.configured) return head + `<div class="panel stack"><p>Für Duelle braucht die App die Server-Verbindung zu Supabase. Die Anleitung steht in der Datei <span class="mono">docs/SUPABASE.md</span>.</p><button data-act="nav" data-v="settings">Zu den Einstellungen</button></div>`;
  if (!Sync.uid) return head + `<div class="panel stack"><p>Melde dich an, um ein Duell zu starten oder mitzuspielen.</p><button class="primary" data-act="nav" data-v="settings">Anmelden</button></div>`;
  const nameField = `<label class="f" for="duelName">Dein Name in der Rangliste<input id="duelName" maxlength="30" value="${esc(S.profile.prefs.displayName || "")}" placeholder="z. B. Lena"></label>`;
  if (D.stage === "menu" || D.stage === "joining") return head + `${D.error ? `<div class="notice bad" role="alert">${esc(D.error)}</div>` : ""}
    <form id="joinForm" class="panel stack"><h3>Beitreten</h3><div class="row nowrap"><input id="joinCode" maxlength="6" placeholder="Code, z. B. K7M2QX" autocomplete="off" style="text-transform:uppercase;font-family:var(--mono)"><button class="primary" type="submit" ${D.stage === "joining" ? "disabled" : ""}>${D.stage === "joining" ? spin : ""}Los</button></div></form>
    <div class="panel stack"><h3>Neues Duell starten</h3>${aiNotice()}
      <label class="f" for="duScope">Stoff<select id="duScope">${scopeOptions(D.scope)}</select></label>
      <label class="f" for="duN">Fragen<select id="duN">${[5,8,12].map(n => `<option ${sel(n === D.n)}>${n}</option>`).join("")}</select></label>
      <button class="primary" data-act="duelCreate" ${Object.keys(S.docs).length ? "" : "disabled"}>Duell erstellen</button>
      <p class="muted small">Alle spielen dieselben Fragen mit 20 Sekunden pro Frage. Schnelle richtige Antworten bringen mehr Punkte.</p></div>`;
  if (D.stage === "creating") return head + `<div class="paper hero"><div class="row"><span class="eyebrow">Bitte warten</span></div><div class="row nowrap">${spin}<span>Claude stellt ${D.n} Duell-Fragen zusammen…</span></div></div>`;
  const link = location.origin + location.pathname + "?d=" + D.id;
  if (D.stage === "lobby") {
    const played = arr(D.players).some(p => p.user_id === Sync.uid && p.finished);
    return head + `<div class="paper hero"><div class="row between"><span class="eyebrow">Duell-Code</span><span class="eyebrow">${esc(D.data.title)} · ${D.data.questions.length} Fragen</span></div>
      <div class="code num">${esc(D.id)}</div>
      <div class="row"><button data-act="copy" data-v="${esc(link)}">Link kopieren</button><button data-act="duelShare" data-v="${esc(link)}">Teilen</button></div></div>
      ${played ? "" : `<div class="panel stack">${nameField}<button class="primary" data-act="duelPlay">Jetzt spielen</button></div>`}
      <section class="stack"><h2>Rangliste</h2>${leaderboard(D)}</section><button class="ghost" data-act="duelLeave">Anderes Duell</button>`;
  }
  if (D.stage === "play") {
    const P = D.play, q = D.data.questions[P.i];
    return `<div class="row between"><span class="eyebrow">Frage ${P.i + 1} / ${D.data.questions.length}</span><span class="eyebrow num">${P.score} Punkte</span></div>
      <div class="progress timer"><i id="duelBar" style="width:${P.picked === null ? clamp((DUEL_SECONDS - (Date.now() - P.t0) / 1000) / DUEL_SECONDS * 100, 0, 100) : 0}%"></i></div>
      <div class="paper fc static"><span class="head"><span class="eyebrow">${esc(D.data.title)}</span></span><span class="qtext">${esc(q.q)}</span></div>
      <div class="duelopts">${q.options.map((o, j) => `<button class="${P.picked === null ? "" : j === q.correct ? "right" : j === P.picked ? "wrong" : "dim"}" data-act="duelAnswer" data-v="${j}" ${P.picked === null ? "" : "disabled"}>${esc(o)}</button>`).join("")}</div>`;
  }
  return head + `<div class="paper hero"><div class="row"><span class="eyebrow">Dein Ergebnis</span></div><div class="row between" style="align-items:flex-end"><div><div class="score num">${D.play.score}</div><p class="muted">${D.play.correct} von ${D.data.questions.length} richtig</p></div></div></div>
    <section class="stack"><h2>Rangliste</h2>${leaderboard(D)}</section><div class="row"><button data-act="copy" data-v="${esc(link)}">Link zum Duell kopieren</button><button class="ghost" data-act="duelLeave">Anderes Duell</button></div>`;
}

/* ---------- Statistik ---------- */
function vStats(){
  if (!S.ready) return vLoading();
  const st = stats(), log = S.profile.log || {};
  const days = []; const d = today(); d.setDate(d.getDate() - 13);
  for (let i = 0; i < 14; i++) { days.push({k:dkey(d), wd:d.toLocaleDateString("de-DE", {weekday:"narrow"}), n:log[dkey(d)]?.n || 0}); d.setDate(d.getDate() + 1); }
  const max = Math.max(5, ...days.map(x => x.n)), total14 = days.reduce((s, x) => s + x.n, 0);
  const okAll = Object.values(log).reduce((s, x) => s + (x.ok || 0), 0), nAll = Object.values(log).reduce((s, x) => s + (x.n || 0), 0);
  const boxes = [0,0,0,0,0,0]; let freshN = 0; allCards().forEach(x => isNew(x.c) ? freshN++ : boxes[boxOf(x.c)]++);
  const labels = ["unter 1 Tag","1–3 Tage","3–7 Tage","1–2 Wochen","2–4 Wochen","über 1 Monat"];
  const weak = allCards().filter(x => isWeak(x.c)).sort((a, b) => (b.c.lapses || 0) - (a.c.lapses || 0)).slice(0, 8);
  return `<div><p class="eyebrow">Fortschritt</p><h1>Statistik</h1></div>
    <div class="statrow">
      <div class="stat"><b>${st.streak}</b><span>Tage in Folge</span></div>
      <div class="stat"><b>${nAll ? Math.round(okAll / nAll * 100) : 0} %</b><span>Trefferquote</span></div>
      <div class="stat"><b>${st.learned}</b><span>von ${st.total} begonnen</span></div>
    </div>
    <section class="panel stack"><div class="row between"><h3>Wiederholungen, 14 Tage</h3><span class="eyebrow num">${total14} gesamt</span></div>
      <div class="bars">${days.map((x, i) => `<div class="bar ${i === 13 ? "today" : ""}" title="${x.k}: ${x.n}"><em>${x.n || ""}</em><i style="height:${Math.round(x.n / max * 100)}%"></i><span>${esc(x.wd)}</span></div>`).join("")}</div>
    </section>
    <section class="panel stack"><h3>Wie lange du dir die Karten merkst</h3><p class="muted small">Die App schätzt für jede Karte, wie lange du sie sicher behältst (FSRS). Ab zwei Wochen gilt sie als sicher gelernt. Noch neu: ${freshN}.</p>
      ${boxes.map((n, i) => `<div class="stack" style="gap:4px"><div class="row between"><span>${labels[i]}</span><span class="num">${n}</span></div><div class="meter" style="--c:${i >= 4 ? "var(--good)" : "var(--accent)"}"><i style="width:${st.total ? n / st.total * 100 : 0}%"></i></div></div>`).join("")}
    </section>
    ${S.profile.subjects.length ? `<section class="panel stack"><h3>Nach Fach</h3>${S.profile.subjects.map(s => {
      const cs = allCards((id, d) => d.subjectId === s.id), m = cs.filter(x => isMastered(x.c)).length;
      return `<button class="plain stack" style="gap:4px" data-act="openSubj" data-v="${esc(s.id)}"><span class="row between nowrap"><span class="row nowrap" style="gap:8px;min-width:0">${subjDot(s)}<span style="overflow-wrap:anywhere">${esc(s.name)}</span></span><span class="num muted" style="white-space:nowrap">${m} / ${cs.length} sicher</span></span><span class="meter" style="--c:var(--s${s.color})"><i style="width:${cs.length ? m / cs.length * 100 : 0}%"></i></span></button>`;
    }).join("")}</section>` : ""}
    ${weak.length ? `<section class="stack"><div class="row between"><h2>Häufig falsch</h2><button class="ghost" data-act="reviewWeak" data-v="all">Üben (${st.weak})</button></div><div class="list">${weak.map(x => `<button class="item" data-act="openDoc" data-v="${esc(x.docId)}"><span class="grow"><span class="t">${cardListQ(x.c)}</span><br><span class="s">${esc(S.docs[x.docId].title)}</span></span><span class="pill due num">${x.c.lapses || 0}× falsch</span></button>`).join("")}</div><p class="muted small">Im jeweiligen Fach findest du die Schwächen-Analyse von Claude.</p></section>` : ""}
    ${arr(S.profile.exams).length ? `<section class="stack"><h2>Übungsklausuren</h2><div class="list">${S.profile.exams.slice(0, 8).map(examItem).join("")}</div></section>` : ""}`;
}

/* ---------- Einstellungen ---------- */
function vPrompts(){
  const P = S.profile, edit = S.promptEdit;
  const ed = edit === "new" ? {id:"", name:"", text:""} : P.prompts.find(p => p.id === edit);
  return `<section class="panel stack" id="prompts"><h3>Masterprompts für Zusammenfassungen</h3>
    <p class="muted small">Der aktive Prompt wird beim Hochladen vorausgewählt. Pro Dokument kannst du jederzeit eine weitere Zusammenfassung mit einem anderen Prompt erstellen und zwischen den Versionen wechseln.</p>
    <div class="list">${P.prompts.map(p => `<div class="item prompt"><label class="check grow" for="ap-${esc(p.id)}"><input type="radio" name="activePrompt" id="ap-${esc(p.id)}" value="${esc(p.id)}" ${p.id === P.activePromptId ? "checked" : ""}><span><span class="t">${esc(p.name)}</span>${p.id === P.activePromptId ? ' <span class="pill">aktiv</span>' : ""}<br><span class="s clamp2">${esc(p.text)}</span></span></label><button class="ghost mini" data-act="editPrompt" data-v="${esc(p.id)}">Bearbeiten</button></div>`).join("")}</div>
    ${ed ? `<form id="promptForm" data-id="${esc(ed.id)}" class="stack"><label class="f" for="pName">Name<input id="pName" required maxlength="40" value="${esc(ed.name)}" placeholder="z. B. Jura-Gutachtenstil"></label>
      <label class="f" for="pText">Masterprompt<textarea id="pText" required maxlength="6000" style="min-height:180px" placeholder="Beschreibe, wie die Zusammenfassung aussehen soll: Aufbau, Länge, Stil, worauf Claude achten soll…">${esc(ed.text)}</textarea></label>
      <div class="row"><button class="primary" type="submit">Speichern</button><button type="button" data-act="editPrompt" data-v="">Abbrechen</button>${ed.id && P.prompts.length > 1 ? `<button type="button" class="danger" data-act="delPrompt" data-v="${esc(ed.id)}">Löschen</button>` : ""}</div></form>`
      : `<button data-act="editPrompt" data-v="new">+ Neuer Masterprompt</button>`}
  </section>`;
}
function fsrsPanel(){
  const u = fsrsUsable(), info = S.profile.prefs.fsrsInfo;
  return `<div class="stack" style="gap:8px"><b>Abstände an dein Gedächtnis anpassen</b>
    <p class="muted small">FSRS rechnet zunächst mit Durchschnittswerten. Ab 200 Wiederholungen mit Verlauf passt die App die Werte an, wie schnell du tatsächlich vergisst. Nutzbar bisher: <span class="num">${u}</span>.</p>
    ${info ? `<p class="small">Angepasst am ${fmtDate(info.date)} mit ${info.n} Wiederholungen. Vorhersagefehler: ${info.before.toFixed(3)} → ${info.after.toFixed(3)} (kleiner ist besser).</p>` : ""}
    <div class="row">${S.busy.fsrs ? `<span class="row nowrap">${spin}<span id="fsrsProg">Rechne…</span></span>` : `<button data-act="fsrsOpt" ${u >= 200 ? "" : "disabled"}>${info ? "Neu anpassen" : "Jetzt anpassen"}</button>`}${info && !S.busy.fsrs ? '<button class="ghost" data-act="fsrsReset">Standardwerte</button>' : ""}</div></div>`;
}
function vSettings(){
  const k = settings.key, src = aiSource(), conf = S.confirm === "wipe", pr = S.profile.prefs, A = S.auth;
  const proxyOk = Sync.configured && Sync.uid;
  return `<div><p class="eyebrow">App</p><h1>Einstellungen</h1></div>
    <section class="panel stack"><h3>Zugang zu Claude</h3>
      <p class="small">Aktuell: <b>${src === "proxy" ? "über deinen Server" : src === "key" ? "eigener API-Schlüssel" : "nicht eingerichtet"}</b></p>
      ${Sync.configured ? `<label class="check" for="useProxy"><input type="checkbox" id="useProxy" ${settings.useProxy ? "checked" : ""} ${proxyOk ? "" : "disabled"}><span>Claude über meinen Supabase-Server nutzen<br><span class="muted small">Der API-Schlüssel liegt dann sicher auf dem Server.${proxyOk ? "" : " Dafür zuerst unten anmelden."}</span></span></label>` : ""}
      <form id="keyForm" class="stack"><label class="f" for="keyIn">Eigener Anthropic-API-Schlüssel<div class="row nowrap"><input id="keyIn" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(k)}"><button type="submit">Speichern</button></div></label>
        <p class="muted small">${k ? "Gespeichert: …" + esc(k.slice(-4)) + ", nur auf diesem Gerät." : "Schlüssel gibt es unter console.anthropic.com. Die Abrechnung läuft über dein API-Guthaben."}</p>
        ${k ? '<button type="button" class="ghost" data-act="clearKey">Schlüssel entfernen</button>' : ""}</form>
      <label class="f" for="modelSel">Modell<select id="modelSel">${MODELS.map(m => `<option value="${m.id}" ${sel(m.id === settings.model)}>${esc(m.label)}</option>`).join("")}</select></label>
    </section>
    ${vPrompts()}
    <section class="panel stack"><h3>Konto und Sync</h3>
      ${!Sync.configured ? `<p class="muted small">Verbinde die App mit deinem Supabase-Projekt, um Karten zwischen Geräten zu synchronisieren, per Link zu teilen und Duelle zu spielen. Anleitung: <span class="mono">docs/SUPABASE.md</span>.</p>`
        : Sync.uid ? `<p class="small">Angemeldet als <b>${esc(Sync.email)}</b> · ${Sync.state === "syncing" ? "synchronisiert gerade…" : Sync.state === "error" ? "Sync-Fehler, neuer Versuch läuft" : "alles synchronisiert"}</p><div class="row"><button data-act="syncNow">Jetzt synchronisieren</button><button class="ghost" data-act="logout">Abmelden</button></div>`
        : `<form id="authForm" class="stack"><label class="f" for="authEmail">E-Mail<input id="authEmail" type="email" autocomplete="email" required value="${esc(A.email)}"></label><label class="f" for="authPw">Passwort<input id="authPw" type="password" autocomplete="current-password" required minlength="6"></label>
          ${A.msg ? `<p class="small" role="status">${esc(A.msg)}</p>` : ""}<div class="row"><button class="primary" type="submit" data-mode="login" ${A.busy ? "disabled" : ""}>Anmelden</button><button type="submit" data-mode="signup" ${A.busy ? "disabled" : ""}>Registrieren</button></div></form>`}
      <details ${Sync.configured ? "" : "open"}><summary class="small">Server-Verbindung</summary><form id="serverForm" class="stack" style="margin-top:10px">
        <label class="f" for="sbUrl">Supabase-URL<input id="sbUrl" placeholder="https://xxxx.supabase.co" value="${esc(settings.sbUrl)}" autocomplete="off"></label>
        <label class="f" for="sbKey">Anon-Key (öffentlich)<input id="sbKey" placeholder="eyJ…" value="${esc(settings.sbKey)}" autocomplete="off"></label>
        <button type="submit">Verbinden</button></form></details>
    </section>
    <section class="panel stack"><h3>Lernen</h3>
      <label class="f" for="newPerDay">Neue Karten pro Tag (Fächer ohne Prüfungstermin)<input id="newPerDay" type="number" min="0" max="200" value="${pr.newPerDay}"></label>
      <label class="f" for="retention">Ziel: Wie sicher sollst du dich erinnern?<select id="retention">${[[0.85,"85 % (weniger Wiederholungen)"],[0.9,"90 % (empfohlen)"],[0.95,"95 % (mehr Wiederholungen)"]].map(([v, l]) => `<option value="${v}" ${sel(Math.abs(pr.retention - v) < .001)}>${l}</option>`).join("")}</select></label>
      ${fsrsPanel()}
    </section>
    <section class="panel stack"><h3>Tägliche Erinnerung</h3>
      <p class="muted small">Legt einen täglichen Termin mit Hinweis in deinem Kalender an (iPhone, Android, Outlook, Google).</p>
      <div class="row nowrap"><input type="time" id="remTime" value="${esc(pr.reminder || "18:00")}" style="max-width:140px"><button data-act="reminder">In Kalender eintragen</button></div>
    </section>
    <section class="panel stack"><h3>YouTube</h3>
      <form id="ytForm" class="stack"><label class="f" for="ytIn">YouTube-Data-API-Schlüssel (optional)<div class="row nowrap"><input id="ytIn" type="password" autocomplete="off" placeholder="AIza…" value="${esc(settings.ytKey)}"><button type="submit">Speichern</button></div></label>
      <p class="muted small">Damit zeigt die App passende Videos mit Vorschaubild direkt im Dokument. Kostenlos in der Google Cloud Console.</p></form>
    </section>
    <section class="panel stack"><h3>App aufs Handy</h3>
      <p class="small">iPhone: in Safari auf <b>Teilen → Zum Home-Bildschirm</b>. Android: im Chrome-Menü auf <b>App installieren</b>. Danach startet die Semesterkartei wie eine normale App und funktioniert zum Lernen auch offline.</p>
      ${S.installPrompt ? '<button class="primary" data-act="install">Jetzt installieren</button>' : ""}
    </section>
    <section class="panel stack"><h3>Daten</h3>
      <p class="muted small">${Sync.uid ? "Deine Karten werden mit deinem Konto synchronisiert. Abbildungen werden mit synchronisiert." : "Deine Karten liegen nur in diesem Browser. Sichere sie regelmäßig."}</p>
      <div class="row"><button data-act="export">Backup herunterladen</button><label class="btn" for="importIn">Backup einspielen<input type="file" id="importIn" accept="application/json,.json" hidden></label></div>
      <div class="row">${conf ? `<span>Wirklich alle Fächer und Karten löschen${Sync.uid ? ", auch im Konto" : ""}?</span><button class="danger" data-act="wipe">Ja, alles löschen</button><button data-act="cancel">Abbrechen</button>` : '<button class="danger" data-act="confirm" data-v="wipe">Alle Daten löschen</button>'}</div>
    </section>`;
}

/* ---------- Geteilten Stapel übernehmen ---------- */
function vImport(){
  const I = S.importShare;
  if (!I) { S.view = "heute"; return vHeute(); }
  if (I.loading) return '<div class="panel row">' + spin + "<span>Geteilte Karten werden geladen…</span></div>";
  if (I.error) return `<div><h1>Link nicht verfügbar</h1></div><div class="notice bad">${esc(I.error)}</div><button data-act="nav" data-v="heute">Zur Startseite</button>`;
  const deck = I.data.deck, docs = arr(deck.docs), n = docs.reduce((a, d) => a + arr(d.cards).length, 0), subs = S.profile.subjects;
  return `<div><p class="eyebrow">Geteilt mit dir</p><h1>${esc(I.data.title)}</h1></div>
    <div class="paper hero"><div class="row"><span class="eyebrow">${docs.length} ${docs.length === 1 ? "Dokument" : "Dokumente"}</span></div><div><div class="big num">${n}</div><p class="muted">Karteikarten mit Zusammenfassungen</p></div></div>
    <div class="list">${docs.map(d => `<div class="item"><span class="grow"><span class="t">${esc(d.title)}</span><br><span class="s">${arr(d.cards).length} Karten</span></span></div>`).join("")}</div>
    <div class="panel stack"><label class="f" for="impSubj">In welches Fach?<select id="impSubj">${subs.map(s => `<option value="${esc(s.id)}" ${sel(I.subjectId === s.id)}>${esc(s.name)}</option>`).join("")}<option value="__new" ${sel(I.subjectId === "__new")}>+ Neues Fach…</option></select></label>
      ${I.subjectId === "__new" ? `<label class="f" for="impNew">Name<input id="impNew" maxlength="60" value="${esc(I.newSubject)}"></label>` : ""}
      <button class="primary" data-act="importShare" ${I.busy ? "disabled" : ""}>${I.busy ? spin + " Übernehme…" : "In meine Kartei übernehmen"}</button><button class="ghost" data-act="cancelImport">Abbrechen</button></div>`;
}

/* ---------- Erklär-Chat (Overlay) ---------- */
function renderSheet(){
  let el = $("#sheet");
  const E = S.explain;
  if (!E) { if (el) el.remove(); document.body.classList.remove("sheet-open"); return; }
  if (!el) { el = document.createElement("div"); el.id = "sheet"; el.className = "sheetwrap"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Erklärung"); document.body.append(el); }
  document.body.classList.add("sheet-open");
  const d = S.docs[E.docId], c = d && arr(d.cards).find(x => x.id === E.cardId);
  el.innerHTML = `<div class="sheetbg" data-act="closeExplain"></div><div class="sheetbox">
    <div class="row between nowrap"><h3>Erklär mir das</h3><button class="ghost mini" data-act="closeExplain" aria-label="Schließen">×</button></div>
    <div class="paper mini-card"><b>${c ? (c.kind === "cloze" ? clozeHtml(c.q, true) : esc(c.q)) : ""}</b>${c && c.a ? `<span class="muted small">${esc(c.a)}</span>` : ""}</div>
    <div class="chat" id="chatLog">${E.msgs.map((m, i) => i === 0 ? "" : `<div class="msg ${m.role}">${m.role === "assistant" ? `<div class="md">${md(m.content)}</div>` : esc(m.content)}</div>`).join("")}
      ${E.busy ? `<div class="msg assistant"><div class="md" id="explainLive">${E.live ? md(E.live) : '<p class="row">' + spin + " Claude denkt nach…</p>"}</div></div>` : ""}
      ${E.error ? `<div class="notice bad">${esc(E.error)}</div>` : ""}</div>
    <form id="chatForm" class="row nowrap"><input id="chatIn" placeholder="Nachfragen…" autocomplete="off" ${E.busy ? "disabled" : ""}><button class="primary" type="submit" ${E.busy ? "disabled" : ""}>Senden</button></form>
    <div class="row"><button class="ghost mini" data-act="chatQuick" data-v="Erklär es noch einfacher.">Einfacher</button><button class="ghost mini" data-act="chatQuick" data-v="Gib mir ein weiteres Beispiel.">Noch ein Beispiel</button><button class="ghost mini" data-act="chatQuick" data-v="Stell mir eine Kontrollfrage dazu.">Kontrollfrage</button></div>
  </div>`;
  renderMath(el);
  const log = $("#chatLog"); if (log) log.scrollTop = log.scrollHeight;
}
