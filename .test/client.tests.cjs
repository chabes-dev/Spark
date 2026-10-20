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
