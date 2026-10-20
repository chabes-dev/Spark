import { startMock } from "./mockredis.mjs";
const {srv,H,state}=await startMock(8799);
process.env.UPSTASH_REDIS_REST_URL="http://localhost:8799";process.env.UPSTASH_REDIS_REST_TOKEN="t";
process.env.SPARK_SYNC_CODE="secret-code";process.env.INBOUND_KEY="ik";process.env.ALLOWED_SENDERS="me@example.com, Other@Example.org";
const sync=(await import("../api/sync.js")).default, inbound=(await import("../api/inbound.js")).default;
const {stripQuoted,parseInbound}=await import("../api/_lib.js");
const call=async(fn,body,query={},headers={'x-real-ip':'10.0.0.1'})=>{let out={};const res={status(c){out.status=c;return res},setHeader(){return res},json(j){out.body=j}};await fn({method:"POST",body,query,headers},res);return out};
const ok=(n,c,x)=>{console.log((c?'PASS':'FAIL')+'  '+n+(x!==undefined?'  ('+JSON.stringify(x)+')':''));if(!c)process.exitCode=1};
// auth
ok('wrong code rejected',(await call(sync,{code:'nope'})).status===401);
ok('wrong inbound key rejected',(await call(inbound,{},{key:'x'})).status===403);
// new email
const e1={envelope:{from:"me@example.com"},headers:{"from":"Marcelo <me@example.com>","message_id":"<a1@mail>","subject":"Agendy name middle child","date":"Sun, 20 Sep 2026 14:55:00 +0100"},plain:"Last child\nFirst child\nMiddle child\n"};
let r=await call(inbound,e1,{key:'ik'});ok('email -> new spark',r.status===200&&!r.body.threaded,r.body);
const sid=r.body.sparkId;
ok('duplicate ignored',(await call(inbound,e1,{key:'ik'})).body.skipped==='duplicate');
// reply on thread (Outlook style quote)
const e2={envelope:{from:"me@example.com"},headers:{"from":"me@example.com","message_id":"<a2@mail>","in_reply_to":"<a1@mail>","references":"<a1@mail>","subject":"Re: Agendy name middle child"},
  plain:"Also: Only child\n\nFrom: Marcelo Chabes <m@x.com>\nDate: Sunday, 20 September 2026 at 14:55\nTo: Marcelo\nSubject: Agendy\n\nLast child\nFirst child"};
r=await call(inbound,e2,{key:'ik'});ok('reply threads onto same spark',r.body.threaded&&r.body.sparkId===sid,r.body);
// pull
r=await call(sync,{code:'secret-code',since:0,push:[]});
const sp=r.body.items.find(x=>x.item.id===sid).item;
ok('pull returns spark with follow-up',sp.thread.length===1&&sp.thread[0].text==='Also: Only child',sp.thread);
ok('title from subject',sp.title==='Agendy name middle child');
// push: LWW
const t=Date.now();
await call(sync,{code:'secret-code',since:r.body.next,push:[{coll:'sparks',item:{...sp,title:'Agency names',updated:t+1000}},{coll:'dumps',item:{id:'d1',text:'pages',updated:t}}]});
await call(sync,{code:'secret-code',since:0,push:[{coll:'sparks',item:{...sp,title:'OLD',updated:t-5000}}]});
r=await call(sync,{code:'secret-code',since:0,push:[]});
ok('newer edit wins',r.body.items.find(x=>x.item.id===sid).item.title==='Agency names');
ok('dumps sync too',!!r.body.items.find(x=>x.coll==='dumps'&&x.item.id==='d1'));
// imported spark with emailIds then a reply threads onto it
await call(sync,{code:'secret-code',since:0,push:[{coll:'sparks',item:{id:'imp1',text:'feet insight',emailIds:['<old1@mail>'],updated:t}}]});
r=await call(inbound,{envelope:{from:"me@example.com"},headers:{"from":"me@example.com","message_id":"<old2@mail>","references":"<old0@mail> <old1@mail>","subject":"Re: feet"},plain:"new thought\n\nOn Thu, 17 Sep 2026 at 12:45, Marcelo wrote:\n> feet insight"},{key:'ik'});
ok('reply to an imported email threads',r.body.sparkId==='imp1'&&r.body.threaded,r.body);
// paging
const many=Array.from({length:450},(_,i)=>({coll:'sessions',item:{id:'s'+i,notes:'x',updated:t}}));
await call(sync,{code:'secret-code',since:0,push:many});
let since=0,got=0,more=true,loops=0;while(more&&loops<10){const q=await call(sync,{code:'secret-code',since,push:[]});got+=q.body.items.length;since=q.body.next;more=q.body.more;loops++}
ok('paging returns everything (450 sessions + 3 earlier items)',got===453,got);
// quote stripping
ok('gmail quote stripped',stripQuoted("hi there\n\nOn Mon, 5 Oct 2026 at 10:00, Marcelo <m@x> wrote:\n> old")==='hi there');
ok('pt quote stripped',stripQuoted("oi\n\nEm seg., 5 de out. de 2026 às 10:00, Marcelo escreveu:\n> velho")==='oi');
ok('html fallback',parseInbound({headers:{},html:"<p>Hello<br>World</p>"}).body==='Hello\nWorld');
// C3: oversized push is refused, never truncated
r=await call(sync,{code:'secret-code',since:0,push:Array.from({length:501},(_,i)=>({coll:'sessions',item:{id:'x'+i,updated:t}}))});
ok('C3 push over 500 items is refused with 413',r.status===413,r.status);
// C5: wrong codes are rate-limited per IP; the right code from that IP is blocked too while locked out
const ip={'x-real-ip':'203.0.113.9'};
for(let i=0;i<8;i++)await call(sync,{code:'guess'+i,since:0,push:[]},{},ip);
r=await call(sync,{code:'secret-code',since:0,push:[]},{},ip);
ok('C5 9th try from a guessing IP is refused with 429',r.status===429,r.status);
r=await call(sync,{code:'secret-code',since:0,push:[]},{},{'x-real-ip':'198.51.100.7'});
ok('C5 another IP is unaffected',r.status===200,r.status);
r=await call(sync,{code:42,since:0,push:[]},{},{'x-real-ip':'198.51.100.8'});
ok('C5 non-string code is a clean 401',r.status===401,r.status);
// H1: pushed items are validated and future timestamps clamped
{
  const now=Date.now();
  r=await call(sync,{code:'secret-code',since:now-1,push:[
    {coll:'sparks',item:{id:'future1',text:'x',updated:9e15}},
    {coll:'sparks',item:{id:'bad id!',text:'x',updated:now}},
    {coll:'sparks',item:{id:'huge',text:'x'.repeat(300000),updated:now}},
    {coll:'sparks',item:{id:'nostamp',text:'x'}},
    {coll:'sparks',item:{id:'__proto__',text:'x',updated:now}}]},{},{'x-real-ip':'10.0.0.2'});
  ok('H1 sync response carries server time',typeof r.body.now==='number',r.body.now);
  ok('H1 invalid items are reported, not stored',(r.body.invalid||[]).length===4,r.body.invalid);
  const f=r.body.items.find(x=>x.item.id==='future1');
  ok('H1 a far-future timestamp is clamped',f&&f.item.updated<=now+11000,f&&f.item.updated);
  r=await call(sync,{code:'secret-code',since:now-1,push:[{coll:'sparks',item:{id:'future1',text:'edited later',updated:Date.now()+10000}}]},{},{'x-real-ip':'10.0.0.2'});
  const g=r.body.items.find(x=>x.item.id==='future1');
  ok('H1 the item can still be edited afterwards',g&&g.item.text==='edited later',g&&g.item.text);
}
// M3: a push older than the stored version comes back as a conflict carrying the stored version
{
  const now=Date.now();
  await call(sync,{code:'secret-code',since:now,push:[{coll:'sparks',item:{id:'m3',text:'new',updated:now+5000}}]},{},{'x-real-ip':'10.0.0.3'});
  r=await call(sync,{code:'secret-code',since:now+60000,push:[{coll:'sparks',item:{id:'m3',text:'old',updated:now}}]},{},{'x-real-ip':'10.0.0.3'});
  const c=(r.body.conflicts||[]).find(x=>x.item.id==='m3');
  ok('M3 rejected push is returned as a conflict with the stored version',c&&c.item.text==='new',r.body.conflicts);
}
// M1: concurrent writes keep every follow-up
{
  const now=Date.now(),ipx={'x-real-ip':'10.0.0.4'};
  const root={headers:{message_id:'<m1root@mail>',subject:'Concurrency',from:'me@example.com'},envelope:{from:'me@example.com'},plain:'root'};
  const rr=await call(inbound,root,{key:'ik'});const id=rr.body.sparkId;
  const reply=(n)=>({headers:{message_id:`<m1r${n}@mail>`,in_reply_to:'<m1root@mail>',subject:'Re: Concurrency',from:'me@example.com'},envelope:{from:'me@example.com'},plain:'reply '+n});
  await Promise.all([1,2,3].map(n=>call(inbound,reply(n),{key:'ik'})));
  let all=await call(sync,{code:'secret-code',since:now-1,push:[]},{},ipx);
  let sp=all.body.items.find(x=>x.item.id===id).item;
  ok('M1 three replies arriving together are all kept',sp.thread.length===3,sp.thread.map(x=>x.text));
  // a device edits tags from a copy that doesn't have the newest reply yet
  const stale={...sp,thread:sp.thread.slice(0,2),tags:['edited'],updated:Date.now()+5000};
  await call(inbound,reply(4),{key:'ik'});
  all=await call(sync,{code:'secret-code',since:now-1,push:[{coll:'sparks',item:stale}]},{},ipx);
  sp=all.body.items.find(x=>x.item.id===id).item;
  ok('M1 an edit from a stale copy keeps the newer reply and the edit',sp.thread.length===4&&sp.tags[0]==='edited',[sp.thread.length,sp.tags]);
  // a follow-up deleted on a device stays deleted
  const gone=sp.thread[0].id;
  all=await call(sync,{code:'secret-code',since:now-1,push:[{coll:'sparks',item:{...sp,thread:sp.thread.slice(1),threadDel:[gone],updated:Date.now()+6000}}]},{},ipx);
  sp=all.body.items.find(x=>x.item.id===id).item;
  ok('M1 a deleted follow-up stays deleted',!sp.thread.some(x=>x.id===gone)&&sp.thread.length===3,sp.thread.length);
}
// C4: only allowed senders can create sparks by email
{
  const mk=(from,env,extra={})=>({envelope:{from:env,...extra},headers:{message_id:`<c4-${Math.random()}@m>`,subject:'spam',from},plain:'buy now'});
  r=await call(inbound,mk('Spammer <spam@evil.com>','spam@evil.com'),{key:'ik'});
  ok('C4 a stranger cannot create a spark',r.status===200&&r.body.skipped==='sender not allowed'&&!r.body.sparkId,r.body);
  r=await call(inbound,mk('Marcelo <me@example.com>','bounce@evil.com'),{key:'ik'});
  ok('C4 a forged From with a foreign envelope sender is refused',r.body.skipped==='sender not allowed',r.body);
  r=await call(inbound,mk('me@example.com','me@example.com',{spf:{result:'fail'}}),{key:'ik'});
  ok('C4 SPF fail is refused',r.body.skipped==='sender not allowed',r.body);
  r=await call(inbound,mk('other@example.org','prvs=123=other@example.org'),{key:'ik'});
  ok('C4 an allowed sender (case-insensitive, BATV bounce address) gets in',!!r.body.sparkId,r.body);
  const saved=process.env.ALLOWED_SENDERS;delete process.env.ALLOWED_SENDERS;
  r=await call(inbound,mk('me@example.com','me@example.com'),{key:'ik'});
  ok('C4 with no allowlist set, email-in is closed',r.body.skipped==='email-in closed: ALLOWED_SENDERS not set',r.body);
  process.env.ALLOWED_SENDERS=saved;
}
// M6: retries and duplicate deliveries never create a second spark, and a failed attempt can be retried
{
  const count=()=>Object.keys(H.items).filter(k=>k.startsWith('sparks:')).length;
  const mail=(extra)=>({envelope:{from:'me@example.com'},headers:{from:'me@example.com',subject:'Dup test',date:'Mon, 19 Oct 2026 10:00:00 +0000',...extra},plain:'same body'});
  let before=count();
  await Promise.all([1,2,3].map(()=>call(inbound,mail({message_id:'<dup1@m>'}),{key:'ik'})));
  ok('M6 the same email delivered 3 times at once makes one spark',count()===before+1,count()-before);
  before=count();
  await call(inbound,mail({}),{key:'ik'});await call(inbound,mail({}),{key:'ik'});
  ok('M6 an email without Message-ID delivered twice makes one spark',count()===before+1,count()-before);
  before=count();
  state.failWhen=(cmds)=>Array.isArray(cmds[0])&&cmds.some(c=>c[0]==='HSET'&&c[1]==='items');
  r=await call(inbound,mail({message_id:'<retry1@m>'}),{key:'ik'});
  state.failWhen=null;
  ok('M6 a failure while writing answers 500 (the mail service retries)',r.status===500,r.status);
  r=await call(inbound,mail({message_id:'<retry1@m>'}),{key:'ik'});
  ok('M6 the retry then creates the spark',!!r.body.sparkId&&count()===before+1,r.body);
}
// M7: Basic Auth (password = INBOUND_KEY) works without the key in the URL
{
  const b64=(x)=>Buffer.from(x).toString('base64');
  const mail={envelope:{from:'me@example.com'},headers:{from:'me@example.com',message_id:'<m7@m>',subject:'basic'},plain:'via basic auth'};
  r=await call(inbound,mail,{},{authorization:'Basic '+b64('spark:wrong')});
  ok('M7 wrong Basic password is refused',r.status===403,r.status);
  r=await call(inbound,mail,{},{authorization:'Basic '+b64('spark:ik')});
  ok('M7 right Basic password is accepted',r.status===200&&!!r.body.sparkId,r.body);
  r=await call(inbound,mail,{key:'ik '},{});
  ok('M7 a near-miss ?key= is refused',r.status===403,r.status);
}
srv.close();
