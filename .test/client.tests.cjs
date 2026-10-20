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
  let since = 0, n = 0, more = true;
  while (more) { const j = await fetch("http://localhost:8800/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "secret-code", since, push: [] }) }).then((r) => r.json()); n += j.items.filter((x) => x.item.id.startsWith("big")).length; since = j.next; more = j.more; }
  ok("C3 all 1300 items reach the server", n === 1300, n);
  ok("C3 sync reports no error", !(await pg.evaluate(() => SYNC.err)), await pg.evaluate(() => SYNC.err));
  await pg.context().close();
};
