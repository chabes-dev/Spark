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
