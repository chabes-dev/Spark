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
