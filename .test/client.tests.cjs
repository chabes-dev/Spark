// One entry per finding in REVIEW.md that has a browser-side part.
module.exports = {
  async C1_offline_edits_are_uploaded_later({ newDevice, ok, serverHas }) {
    const pg = await newDevice();
    await pg.evaluate(() => syncNow());
    await pg.evaluate(() => { S.dumps.unshift({ id: "plane", text: "pages written on a plane", created: Date.now(), words: 5 }); saveLocal(); });
    await pg.route("**/api/sync", (r) => r.abort());               // offline
    await pg.evaluate(() => syncNow());
    ok("C1 failed sync reports an error", !!(await pg.evaluate(() => SYNC.err)));
    await pg.unroute("**/api/sync");                               // back online
    await pg.evaluate(() => syncNow());
    ok("C1 offline pages reach the server once back online", !!(await serverHas("dumps", "plane")));
    await pg.evaluate(() => { S.dumps = S.dumps.filter((d) => d.id !== "plane"); saveLocal(); });
    await pg.route("**/api/sync", (r) => r.abort());
    await pg.evaluate(() => syncNow());
    await pg.unroute("**/api/sync");
    await pg.evaluate(() => syncNow());
    const it = await serverHas("dumps", "plane");
    ok("C1 an offline delete also reaches the server", it && it.item.deleted === true);
    await pg.context().close();
  },
};
module.exports.C3_big_library_uploads_completely = async ({ newDevice, ok, pull }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { for (let i = 0; i < 1300; i++) S.sessions.push({ id: "big" + i, notes: "x", startedAt: Date.now() - i, minutes: 10 }); saveLocal(); return syncNow(); });
  const n = (await pull()).items.filter((x) => x.item.id.startsWith("big")).length;
  ok("C3 all 1300 items reach the server", n === 1300, n);
  ok("C3 sync reports no error", !(await pg.evaluate(() => SYNC.err)), await pg.evaluate(() => SYNC.err));
  await pg.context().close();
};
module.exports.C2_wiped_device_does_not_delete_everything = async ({ newDevice, ok, pull }) => {
  const a = await newDevice();
  await a.evaluate(() => { for (let i = 0; i < 30; i++) S.sparks.push({ id: "keep" + i, text: "spark " + i, created: Date.now() - i }); saveLocal(); return syncNow(); });
  // the device loses its data but keeps its sync state (corrupt save, bug, partial clear)
  await a.evaluate(() => { S.sparks = []; saveLocal(); return syncNow(); });
  const live = (await pull()).items.filter((x) => x.item.id.startsWith("keep") && !x.item.deleted).length;
  ok("C2 the server still has all 30 sparks", live === 30, live);
  ok("C2 the wiped device gets them back", (await a.evaluate(() => S.sparks.filter((s) => s.id.startsWith("keep")).length)) === 30);
  ok("C2 the device warns about held-back deletions", /deletion/i.test(await a.evaluate(() => SYNC.warn || "")));
  // a normal, small delete still goes through
  await a.evaluate(() => { S.sparks = S.sparks.filter((s) => s.id !== "keep1"); saveLocal(); return syncNow(); });
  const k1 = (await pull()).items.find((x) => x.item.id === "keep1");
  ok("C2 a single delete still syncs", k1 && k1.item.deleted === true);
  await a.context().close();
};
module.exports.H1_device_with_wrong_clock_uses_server_time = async ({ newDevice, ok, pull }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { const real = Date.now; Date.now = () => real() + 86400000; }); // clock a day ahead
  await pg.evaluate(() => syncNow());                                                       // learns the server time
  await pg.evaluate(() => { S.sparks.unshift({ id: "skewed", text: "written with a bad clock", created: Date.now() }); saveLocal(); return syncNow(); });
  const it = (await pull()).items.find((x) => x.item.id === "skewed");
  ok("H1 the server copy is not stamped a day ahead", it && Math.abs(it.item.updated - Date.now()) < 60000, it && (it.item.updated - Date.now()));
  const local = await pg.evaluate(() => S.sparks.find((s) => s.id === "skewed").updated);
  ok("H1 the device's own copy is stamped with server time too", Math.abs(local - Date.now()) < 5000, local - Date.now());
  await pg.context().close();
};
const post = (body) => fetch("http://localhost:8800/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "secret-code", since: Date.now(), ...body }) }).then((r) => r.json());
module.exports.M3_rejected_push_adopts_the_server_version = async ({ newDevice, ok }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { S.sparks.unshift({ id: "contested", text: "v1", created: Date.now() }); saveLocal(); return syncNow(); });
  // another device writes a newer version that this device has already "seen past" (its since is later)
  await post({ push: [{ coll: "sparks", item: { id: "contested", text: "newer elsewhere", created: Date.now(), updated: Date.now() + 9000 } }] });
  await pg.evaluate(() => { SYNC.since = Date.now() + 60000; saveSync(); });
  await pg.evaluate(() => { S.sparks.find((s) => s.id === "contested").text = "older local edit"; saveLocal(); return syncNow(); });
  ok("M3 the device adopts the server's newer version", (await pg.evaluate(() => S.sparks.find((s) => s.id === "contested").text)) === "newer elsewhere");
  await pg.context().close();
};
module.exports.M2_typing_during_a_sync_is_not_overwritten = async ({ newDevice, ok, pull }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { S.sparks.unshift({ id: "typing", text: "first", created: Date.now() }); saveLocal(); return syncNow(); });
  await pg.route("**/api/sync", async (r) => { await new Promise((x) => setTimeout(x, 400)); r.continue(); }); // slow network
  await pg.evaluate(() => { S.sparks.find((s) => s.id === "typing").text = "second"; saveLocal(); window.__p = syncNow(); });
  await pg.evaluate(() => { S.sparks.find((s) => s.id === "typing").text = "third, typed while syncing"; saveLocal(); return window.__p; });
  await pg.unroute("**/api/sync");
  ok("M2 text typed during the sync survives the echo", (await pg.evaluate(() => S.sparks.find((s) => s.id === "typing").text)) === "third, typed while syncing");
  await pg.evaluate(() => syncNow());
  const it = (await pull()).items.find((x) => x.item.id === "typing");
  ok("M2 and it reaches the server on the next sync", it && it.item.text === "third, typed while syncing", it && it.item.text);
  await pg.context().close();
};
module.exports.M1_deleted_follow_up_stays_deleted = async ({ newDevice, ok, pull }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { S.sparks.unshift({ id: "fu", text: "root", created: Date.now(), thread: [{ id: "f1", text: "keep", created: 1 }, { id: "f2", text: "drop", created: 2 }] }); saveLocal(); return syncNow(); });
  await pg.evaluate(() => { S.ui.view = "sparks"; render(); openSpark("fu"); });
  await pg.click('[data-fudel="f2"]');
  await pg.evaluate(() => syncNow());
  const it = (await pull()).items.find((x) => x.item.id === "fu");
  ok("M1 a follow-up deleted in the app stays deleted after the server merge", it && it.item.thread.length === 1 && it.item.thread[0].id === "f1", it && it.item.thread.map((x) => x.id));
  await pg.context().close();
};
module.exports.M4_failing_classify_backs_off = async ({ newDevice, ok }) => {
  const pg = await newDevice();
  let calls = 0;
  await pg.route("**/api/classify", (r) => { calls++; r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"server error"}' }); });
  await pg.evaluate(() => { S.sparks.unshift({ id: "uncl", text: "please sort me", created: Date.now() }); saveLocal(); SYNC.ai = true; classifyPending(); });
  await pg.waitForTimeout(5000);
  ok("M4 a failing classify is not retried every 1.5 s", calls <= 1, calls + " calls in 5 s");
  await pg.evaluate(() => classifyPending());                       // what every sync does
  ok("M4 the once-a-minute sync doesn't bypass the backoff", calls <= 1, calls);
  // after 3 failed attempts a spark is given up on
  await pg.evaluate(async () => { for (let i = 0; i < 3; i++) { CLASSIFY_NEXT = 0; clearTimeout(CLASSIFY_TIMER); await classifyPending(); } });
  ok("M4 a spark is given up after 3 failed attempts", await pg.evaluate(() => { const s = S.sparks.find((x) => x.id === "uncl"); return s.classified === true && s.classifyTries >= 3; }));
  await pg.unroute("**/api/classify");
  await pg.context().close();
};
module.exports.L2_only_web_links_are_rendered = async ({ newDevice, ok }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { S.sparks.unshift({ id: "lnk", text: "see this", created: Date.now(), links: ["javascript:alert(document.cookie)", " JaVaScRiPt:alert(1)", "data:text/html,x", "https://ok.example/page"] }); saveLocal(); S.ui.view = "sparks"; S.ui.sparkQ = ""; S.ui.shelf = "all"; render(); });
  const card = await pg.$$eval('.spark[data-id="lnk"] a', (a) => a.map((x) => x.getAttribute("href")));
  await pg.evaluate(() => openSpark("lnk"));
  const sheet = await pg.$$eval(".sdlinks a", (a) => a.map((x) => x.getAttribute("href")));
  ok("L2 a card renders only http(s) links", card.length === 1 && card[0] === "https://ok.example/page", JSON.stringify(card));
  ok("L2 the spark sheet renders only http(s) links", sheet.length === 1 && sheet[0] === "https://ok.example/page", JSON.stringify(sheet));
  await pg.context().close();
};
module.exports.capture_box_tags_and_project_filter = async ({ newDevice, ok }) => {
  const pg = await newDevice();
  await pg.evaluate(() => { S.sparks = []; newProject("Naming"); S.ui.view = "sparks"; render(); });
  await pg.click("#cap"); await pg.keyboard.type("Pedicure for #hikers"); await pg.keyboard.press("Shift+Enter"); await pg.keyboard.type("#feet #ooh");
  await pg.click("#capkeep"); await pg.waitForTimeout(400);
  const sp = await pg.evaluate(() => S.sparks[0]);
  ok("capture: Keep button saves, #tags become tags, a tags-only line is dropped", sp && sp.text === "Pedicure for #hikers" && sp.tags.join() === "hikers,feet,ooh", JSON.stringify(sp && [sp.text, sp.tags]));
  await pg.click("#cap"); await pg.keyboard.type("Last child");
  await pg.click("#capproj"); await pg.click('.picktile:has-text("Naming")');
  ok("capture: draft survives the project picker", (await pg.inputValue("#cap")) === "Last child");
  await pg.click("#capkeep"); await pg.waitForTimeout(400);
  await pg.selectOption("#projsel", { label: "Naming" }); await pg.waitForTimeout(200);
  ok("project filter shows only that project's sparks", (await pg.$$("#sparkres .spark")).length === 1);
  await pg.evaluate(() => { S.ui.sparkProj = null; saveLocal(); });
  await pg.context().close();
};
module.exports.why_note_and_facets = async ({ newDevice, ok, pull }) => {
  const pg = await newDevice();
  let sent = null;
  await pg.route("**/api/classify", async (r) => {
    sent = JSON.parse(r.request().postData());
    const it = sent.items[0];
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [{ id: it.id, kind: "idea", title: "Slowest man for time-lapse", tags: ["video"],
      facets: { tone: ["funny", "absurd"], brands: ["Apple"], categories: ["tech"], products: ["time-lapse"], themes: ["slowness"], formats: ["social video"] } }] }) });
  });
  await pg.evaluate(() => { S.sparks.unshift({ id: "slow", text: "Homem mais lento do mundo pra promover timelapse\nhttps://youtube.com/shorts/LLgiPER4ctk", created: Date.now(), tags: [], classified: true }); saveLocal(); SYNC.ai = true; saveSync(); S.ui.view = "sparks"; S.ui.sparkQ = ""; S.ui.sparkTag = null; S.ui.sparkProj = null; render(); });
  await pg.click('.spark[data-id="slow"] .t');
  ok("why: the sheet invites you to write why", !!(await pg.$(".sdnoteinvite")));
  await pg.click("#sdnotego");
  ok("why: opens the writing canvas with the spark as context", (await pg.textContent(".notectx")).includes("Homem mais lento"));
  ok("why: the writing fades and has the lock switch, like pages", await pg.$eval("#rtext", (t) => t.classList.contains("fading")) && !!(await pg.$("#clock")));
  await pg.click("#rtext");
  await pg.keyboard.type("a guy who is the slowest person on earth, so funny for time lapse. would work for apple #floors");
  await pg.keyboard.press("Escape"); await pg.waitForTimeout(1500);
  const s = await pg.evaluate(() => S.sparks.find((x) => x.id === "slow"));
  ok("why: the note is saved on the spark", s.note.startsWith("a guy who is the slowest"));
  ok("why: #tags in the note become tags", (s.tags || []).includes("floors"), JSON.stringify(s.tags));
  ok("why: the AI gets the note separately", sent && sent.items[0].note.includes("slowest person") && !sent.items[0].text.includes("slowest person"));
  ok("why: facets are stored", s.facets && s.facets.brands[0] === "Apple" && s.facets.tone.length === 2, JSON.stringify(s.facets));
  ok("why: back on the spark sheet, the note and facets show", (await pg.textContent(".sdnotet")).includes("slowest") && (await pg.$$(".fchip")).length === 7);
  await pg.click('.fchip:has-text("Apple")');
  ok("why: tapping a facet searches for it", (await pg.inputValue("#sq")) === "Apple" && (await pg.$$('#sparkres .spark[data-id="slow"]')).length === 1);
  ok("why: the card shows the note and facets", (await pg.textContent('.spark[data-id="slow"] .snote')).includes("slowest") && (await pg.$$('.spark[data-id="slow"] .sfacets span')).length >= 2);
  await pg.evaluate(() => syncNow());
  const srv = (await pull()).items.find((x) => x.item.id === "slow");
  ok("why: the note and facets sync", srv && srv.item.note.includes("slowest") && srv.item.facets.brands[0] === "Apple");
  await pg.screenshot({ path: "/tmp/claude-0/-home-user-Spark/4c9f90c7-4736-51ca-9905-9c48800840b5/scratchpad/why-card.png" });
  await pg.evaluate(() => { S.ui.sparkQ = ""; saveLocal(); });
  await pg.unroute("**/api/classify");
  await pg.context().close();
};
module.exports.backup_restore = async ({ newDevice, ok }) => {
  // the old address: a spark, a page, a draft and non-default settings, none of it synced
  const a = await newDevice();
  await a.evaluate(() => { SYNC.code = ""; saveSync();
    S.sparks.unshift({ id: "bk1", text: "old idea", created: 1000, updated: 1000 }, { id: "bk2", text: "edited here later", created: 1000, updated: 1000 });
    S.dumps.unshift({ id: "bkd", text: "an old page", created: 2000, words: 3 });
    S.dumpDraft = { text: "half a page", startedAt: 3000 }; S.settings.theme = "clean"; S.settings.typingVol = 0.2; saveLocal();
    S.ui.view = "sparks"; render(); });
  await a.click("#backupbtn");
  const [dl] = await Promise.all([a.waitForEvent("download"), a.click("#bkgo")]);
  const file = "/tmp/claude-0/-home-user-Spark/4c9f90c7-4736-51ca-9905-9c48800840b5/scratchpad/spark-backup-test.json";
  await dl.saveAs(file);
  ok("backup: the file is named spark-backup-<date>.json", /^spark-backup-\d{4}-\d\d-\d\d\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  await a.context().close();
  // the new address: its own spark, a newer copy of bk2 and its own draft
  const b = await newDevice();
  await b.evaluate(() => { SYNC.code = ""; saveSync();
    S.sparks.unshift({ id: "new1", text: "written on the new address", created: 5000, updated: 5000 }, { id: "bk2", text: "edited on the new address", created: 1000, updated: 9000 });
    S.dumpDraft = { text: "today's draft", startedAt: 6000 }; saveLocal(); S.ui.view = "sparks"; render(); });
  await b.click("#backupbtn");
  await b.setInputFiles("#bkfile", file);
  await b.waitForTimeout(500);
  const s = await b.evaluate(() => ({ sparks: S.sparks.map((x) => x.id + ":" + x.text), dumps: S.dumps.map((d) => d.title || d.text), draft: S.dumpDraft.text, theme: S.settings.theme, vol: S.settings.typingVol,
    stored: JSON.parse(localStorage.getItem("spark_v1")).sparks.length }));
  ok("restore: sparks from the backup are added", s.sparks.includes("bk1:old idea"), JSON.stringify(s.sparks));
  ok("restore: sparks written here are kept", s.sparks.includes("new1:written on the new address"));
  ok("restore: the newer copy wins", s.sparks.includes("bk2:edited on the new address") && !s.sparks.includes("bk2:edited here later"));
  ok("restore: pages come back", s.dumps.includes("an old page"));
  ok("restore: the old draft is kept as a page, today's draft stays", s.dumps.includes("Recovered draft") && s.draft === "today's draft", JSON.stringify(s.dumps));
  ok("restore: settings come from the backup", s.theme === "clean" && s.vol === 0.2);
  ok("restore: saved to the device", s.stored === s.sparks.length);
  await b.click("#backupbtn"); await b.setInputFiles("#bkfile", file); await b.waitForTimeout(500);
  ok("restore: restoring twice adds nothing", (await b.evaluate(() => S.sparks.length)) === s.sparks.length && (await b.evaluate(() => S.dumps.filter((d) => d.title === "Recovered draft").length)) === 1);
  await b.context().close();
};
module.exports.restore_pages_txt = async ({ newDevice, ok }) => {
  for (const locale of ["en-US", "pt-BR"]) {
    // the old address's only export: morning pages as .txt, dates written in the device's own locale
    const a = await newDevice({ locale });
    await a.evaluate(() => { SYNC.code = ""; saveSync();
      S.dumps = [{ id: "t1", text: "first page\n\nwith a blank line", created: new Date(2026, 9, 3, 7, 5).getTime(), words: 6 },
        { id: "t2", text: "second page", created: new Date(2026, 9, 21, 19, 40).getTime(), words: 2 }]; saveLocal(); });
    const [dl] = await Promise.all([a.waitForEvent("download"), a.evaluate(() => exportDumps())]);
    const file = `/tmp/claude-0/-home-user-Spark/4c9f90c7-4736-51ca-9905-9c48800840b5/scratchpad/pages-${locale}.txt`;
    await dl.saveAs(file); await a.context().close();
    const b = await newDevice({ locale });
    await b.evaluate(() => { SYNC.code = ""; saveSync(); S.dumps = [{ id: "keep", text: "second page", created: 1, words: 2 }]; saveLocal(); S.ui.view = "sparks"; render(); });
    await b.click("#backupbtn"); await b.setInputFiles("#bkfile", file); await b.waitForTimeout(400);
    const d = await b.evaluate(() => S.dumps.map((x) => [x.text, new Date(x.created).toISOString().slice(0, 16)]));
    const first = d.find((x) => x[0].startsWith("first page"));
    ok(`restore .txt (${locale}): the missing page comes back with its text`, first && first[0] === "first page\n\nwith a blank line", JSON.stringify(d));
    ok(`restore .txt (${locale}): with its date`, first && first[1] === new Date(2026, 9, 3, 7, 5).toISOString().slice(0, 16), first && first[1]);
    ok(`restore .txt (${locale}): a page already here isn't doubled`, d.filter((x) => x[0] === "second page").length === 1);
    await b.click("#backupbtn"); await b.setInputFiles("#bkfile", file); await b.waitForTimeout(300);
    ok(`restore .txt (${locale}): restoring again says it's all here`, (await b.textContent("#bkres")).includes("already here"));
    await b.context().close();
  }
};
