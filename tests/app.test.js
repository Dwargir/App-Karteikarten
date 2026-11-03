"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {load} = require("./load.js");

test("FSRS: neue Karte – Leicht > Gut > Schwer, Nochmal in 10 Minuten", () => {
  const {run} = load();
  const now = Date.now();
  const r = run(`[1,2,3,4].map(g => FSRS.next({reps:0}, g, ${now}))`);
  assert.equal(r[0].days, 0);
  assert.equal(r[0].due, now + 10 * 60000);
  assert.ok(r[1].days <= r[2].days && r[2].days < r[3].days, JSON.stringify(r.map(x => x.days)));
  assert.equal(r[2].s, run("FSRS.DEFAULT[2]"));
});

test("FSRS: Abstand wächst nach erfolgreicher Wiederholung, sinkt nach Fehler", () => {
  const {run} = load();
  const day = 864e5, now = Date.now();
  const card = {reps:1, s:4, d:5, last:now - 4 * day};
  const good = run(`FSRS.next(${JSON.stringify(card)}, 3, ${now})`);
  const again = run(`FSRS.next(${JSON.stringify(card)}, 1, ${now})`);
  assert.ok(good.s > card.s);
  assert.ok(again.s < card.s);
});

test("FSRS: Anpassung verringert den Vorhersagefehler auf Daten, die vergesslicher sind als der Standard", async () => {
  const {run} = load();
  // Simulierter Lernverlauf: echte Stabilität ist ein Drittel der Standardannahme
  const items = run(`(() => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const items = [], t0 = Date.UTC(2026, 0, 1);
    for (let c = 0; c < 150; c++) {
      let st = null, t = t0 + c * 1000;
      for (let k = 0; k < 6; k++) {
        let g;
        if (!st) g = 3;
        else { const el = 1 + Math.floor(rnd() * 10); t += el * DAY; g = rnd() < FSRS.r(el, st.s / 3) ? 3 : 1; }
        items.push(["c" + c, t, g, k === 0 ? 1 : 0]);
        st = FSRS.step(FSRS.DEFAULT, st, g, st ? (items.at(-1)[1] - items.at(-2)[1]) / DAY : 0);
      }
    }
    return items;
  })()`);
  const res = await load().raw("FSRS.optimize.bind(FSRS)")(items, {iters:12});
  assert.equal(res.ok, true);
  assert.ok(res.n >= 200);
  assert.ok(res.after < res.before, `${res.after} < ${res.before}`);
});

test("FSRS: zu wenig Verlauf wird abgelehnt", async () => {
  const {run} = load();
  const res = await load().raw("FSRS.optimize.bind(FSRS)")([["a", 1, 3, 1], ["a", 2 * 864e5, 3, 0]]);
  assert.equal(res.ok, false);
});

test("Markdown: escaped HTML, Fett, Listen, Formeln bleiben erhalten", () => {
  const {run} = load();
  const html = run(`md("## Titel\\n- **fett** <script>\\n- $a<b$")`);
  assert.match(html, /<h3>Titel<\/h3>/);
  assert.match(html, /<strong>fett<\/strong> &lt;script&gt;/);
  assert.match(html, /\$a&lt;b\$/);
  assert.doesNotMatch(html, /<script>/);
});

test("parseJSON: mit Codeblock und LaTeX-Backslashes", () => {
  const {run} = load();
  assert.deepEqual(run("parseJSON('```json\\n{\"a\":1}\\n```')"), {a:1});
  const parse = load().raw("parseJSON");
  assert.equal(parse(String.raw`{"q":"$\\frac{1}{2}$"}`).q, String.raw`$\frac{1}{2}$`);
  // einzelner Backslash vor einem Zeichen, das in JSON kein Escape ist, wird repariert
  assert.equal(parse(String.raw`{"q":"$\alpha$"}`).q, String.raw`$\alpha$`);
});

test("splitText: Teile sind höchstens max lang, ergeben zusammen das Original und schneiden an Seitenmarken", () => {
  const {run} = load();
  const text = Array.from({length:40}, (_, i) => `\n[Seite ${i + 1}]\n` + "x".repeat(900)).join("");
  const parts = run(`splitText(${JSON.stringify(text)}, 5000)`);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(""), text);
  for (const p of parts) assert.ok(p.length <= 5000);
  for (const p of parts.slice(1)) assert.ok(p.startsWith("\n[Seite "));
  assert.deepEqual(run(`splitText("kurz", 100)`), ["kurz"]);
});

test("PowerPoint: Absätze, Entities und Bild-Verknüpfungen", () => {
  const {run} = load();
  const xml = '<p:sp><a:p><a:r><a:t>Hallo </a:t></a:r><a:r><a:t xml:space="preserve">Welt &amp; Co</a:t></a:r></a:p><a:p><a:r><a:t>&#252;ber &lt;3</a:t></a:r></a:p><a:p></a:p></p:sp>';
  assert.equal(run(`pptxText(${JSON.stringify(xml)})`), "Hallo Welt & Co\nüber <3");
  const rels = '<Relationships><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.png"/><Relationship Target="../notesSlides/notesSlide1.xml" Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"/></Relationships>';
  assert.deepEqual(run(`relTargets(${JSON.stringify(rels)}, "image")`), ["../media/image3.png"]);
  assert.equal(run(`resolvePath("ppt/slides/slide1.xml", "../media/image3.png")`), "ppt/media/image3.png");
  assert.equal(run(`relTargets(${JSON.stringify(rels)}, "notesSlide")[0]`), "../notesSlides/notesSlide1.xml");
});

test("Sync: Karten von zwei Geräten werden einzeln zusammengeführt", () => {
  const {run} = load();
  const out = run(`(() => {
    const base = {type:"doc", title:"T", _u:100, cards:[{id:"a", q:"A", a:"1", u:10, reps:0}, {id:"b", q:"B", a:"2", u:10, reps:0}, {id:"c", q:"C", a:"3", u:10}]};
    const handy = structuredClone(base), laptop = structuredClone(base);
    handy._u = 200; handy.cards[0] = {...handy.cards[0], reps:1, s:3, u:150};           // Karte a gelernt
    laptop._u = 300; laptop.cards[1] = {...laptop.cards[1], reps:1, s:2, u:250};        // Karte b gelernt
    laptop.cards = laptop.cards.filter(c => c.id !== "c"); laptop.delCards = {c:260};  // Karte c gelöscht
    laptop.cards.push({id:"d", q:"D", a:"4", u:270});                                 // Karte d neu
    return mergeValue("d-1", handy, laptop);
  })()`);
  const by = Object.fromEntries(out.cards.map(c => [c.id, c]));
  assert.equal(by.a.reps, 1);
  assert.equal(by.b.reps, 1);
  assert.equal(by.c, undefined);
  assert.ok(by.d);
});

test("Sync: neuere Änderung schlägt ältere Löschung", () => {
  const {run} = load();
  const out = run(`mergeValue("d-1", {type:"doc", _u:1, cards:[{id:"a", q:"neu", a:"x", u:500}]}, {type:"doc", _u:2, cards:[], delCards:{a:400}})`);
  assert.equal(out.cards.length, 1);
  assert.equal(out.cards[0].q, "neu");
});

test("Sync: Profil – Tageslog, Fächer und Löschungen", () => {
  const {run} = load();
  const out = run(`(() => {
    const a = normProfile({_u:10, subjects:[{id:"s1", name:"Mathe"}, {id:"s2", name:"Alt"}], log:{"2026-11-01":{n:5, ok:4, newBy:{s1:3}}}});
    const b = normProfile({_u:20, subjects:[{id:"s1", name:"Mathe"}, {id:"s3", name:"Bio"}], delSubjects:{s2:15}, log:{"2026-11-01":{n:7, ok:5, newBy:{s1:2}}, "2026-11-02":{n:1, ok:1}}});
    return mergeValue("profile", a, b);
  })()`);
  assert.deepEqual(out.subjects.map(s => s.id).sort(), ["s1", "s3"]);
  assert.equal(out.log["2026-11-01"].n, 7);
  assert.equal(out.log["2026-11-01"].newBy.s1, 3);
  assert.equal(out.log["2026-11-02"].n, 1);
});

test("Sync: Lernverlauf – Vereinigung, zurückgenommene Einträge bleiben weg", () => {
  const {run} = load();
  const out = run(`mergeRevlog({items:[["a",1,3,1],["a",5,3,0]], del:["a|5"]}, {items:[["a",5,3,0],["b",2,1,1]]})`);
  assert.deepEqual(out.items.map(x => x[0] + x[1]), ["a1", "b2"]);
});

test("Lernplan: neue Karten werden bis zur Prüfung verteilt", () => {
  const {run} = load();
  const quota = run(`(() => {
    const d = new Date(); d.setDate(d.getDate() + 12);
    S.profile.subjects = [{id:"s1", name:"Mathe", color:0, examDate:dkey(d)}];
    S.docs = {"d-1": normDoc({type:"doc", subjectId:"s1", title:"T", createdAt:1, cards:Array.from({length:100}, (_, i) => newCard("F" + i, "A"))})};
    return planToday()[0];
  })()`);
  assert.equal(quota.left, 12);
  assert.equal(quota.perDay, 10);
  assert.equal(quota.quota, 10);
});

test("Abfrage: Bewertung zurücknehmen stellt Karte, Tageslog und Verlauf wieder her", () => {
  const {run} = load();
  const res = run(`(() => {
    S.profile.subjects = [{id:"s1", name:"Mathe", color:0}];
    S.docs = {"d-1": normDoc({type:"doc", subjectId:"s1", title:"T", createdAt:1, cards:[newCard("F", "A")]})};
    startReview("all", "all");
    S.review.shown = true;
    const before = structuredClone(S.docs["d-1"].cards[0]);
    grade(2);
    const graded = S.docs["d-1"].cards[0].reps;
    undoGrade();
    const c = S.docs["d-1"].cards[0];
    return {graded, reps:c.reps, s:c.s, q:c.q, log:S.profile.log[dkey()] || null, rev:S.revlog.items.length, queue:S.review.queue.length, shown:S.review.shown, beforeReps:before.reps};
  })()`);
  assert.equal(res.graded, 1);
  assert.equal(res.reps, res.beforeReps);
  assert.equal(res.s, undefined);
  assert.equal(res.log, null);
  assert.equal(res.rev, 0);
  assert.equal(res.queue, 1);
  assert.equal(res.shown, true);
});

test("Karten bearbeiten, löschen und suchen", () => {
  const {run} = load();
  const res = run(`(() => {
    S.docs = {"d-1": normDoc({type:"doc", subjectId:"s1", title:"Zellbio", createdAt:1, cards:[newCard("Was ist ATP?", "Energieträger"), newCard("Wo liegt die Glykolyse?", "Cytoplasma")]})};
    const [a, b] = S.docs["d-1"].cards;
    editCard("d-1", a.id, {kind:"cloze", q:"{{ATP}} ist der Energieträger", a:""});
    deleteCard("d-1", b.id);
    return {kind:S.docs["d-1"].cards[0].kind, n:S.docs["d-1"].cards.length, tomb:!!S.docs["d-1"].delCards[b.id], hits:searchCards("energie atp").length, none:searchCards("glykolyse").length};
  })()`);
  assert.deepEqual(res, {kind:"cloze", n:1, tomb:true, hits:1, none:0});
});

test("Prompt-Caching: Lernmaterial steht als system-Block mit cache_control", () => {
  const {run} = load();
  const sys = run(`cachedSystem("Material")`);
  assert.equal(sys.length, 1);
  assert.deepEqual(sys[0].cache_control, {type:"ephemeral"});
  assert.match(sys[0].text, /<material>\nMaterial\n<\/material>/);
  assert.equal(run(`cachedSystem("")`), undefined);
  // gleiche Eingabe -> byte-gleicher Text (Voraussetzung für Cache-Treffer)
  assert.equal(run(`docContext({title:"T", text:"abc"}) === docContext({title:"T", text:"abc"})`), true);
});

test("Ansichten: Suchergebnisse escapen Nutzertext", () => {
  const {run} = load();
  const html = run(`(() => { S.docs = {"d-1": normDoc({type:"doc", subjectId:"s1", title:"<b>T</b>", createdAt:1, cards:[newCard("<img src=x onerror=alert(1)> Frage", "Antwort")]})}; return searchResults("frage"); })()`);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
