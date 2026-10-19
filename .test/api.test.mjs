import { startMock } from "./mockredis.mjs";
const {srv,H}=await startMock(8799);
process.env.UPSTASH_REDIS_REST_URL="http://localhost:8799";process.env.UPSTASH_REDIS_REST_TOKEN="t";
process.env.SPARK_SYNC_CODE="secret-code";process.env.INBOUND_KEY="ik";
const sync=(await import("../api/sync.js")).default, inbound=(await import("../api/inbound.js")).default;
const {stripQuoted,parseInbound}=await import("../api/_lib.js");
const call=async(fn,body,query={})=>{let out={};const res={status(c){out.status=c;return res},setHeader(){return res},json(j){out.body=j}};await fn({method:"POST",body,query},res);return out};
const ok=(n,c,x)=>console.log((c?'PASS':'FAIL')+'  '+n+(x!==undefined?'  ('+JSON.stringify(x)+')':''));
// auth
ok('wrong code rejected',(await call(sync,{code:'nope'})).status===401);
ok('wrong inbound key rejected',(await call(inbound,{},{key:'x'})).status===403);
// new email
const e1={headers:{"message_id":"<a1@mail>","subject":"Agendy name middle child","date":"Sun, 20 Sep 2026 14:55:00 +0100"},plain:"Last child\nFirst child\nMiddle child\n"};
let r=await call(inbound,e1,{key:'ik'});ok('email -> new spark',r.status===200&&!r.body.threaded,r.body);
const sid=r.body.sparkId;
ok('duplicate ignored',(await call(inbound,e1,{key:'ik'})).body.skipped==='duplicate');
// reply on thread (Outlook style quote)
const e2={headers:{"message_id":"<a2@mail>","in_reply_to":"<a1@mail>","references":"<a1@mail>","subject":"Re: Agendy name middle child"},
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
r=await call(inbound,{headers:{"message_id":"<old2@mail>","references":"<old0@mail> <old1@mail>","subject":"Re: feet"},plain:"new thought\n\nOn Thu, 17 Sep 2026 at 12:45, Marcelo wrote:\n> feet insight"},{key:'ik'});
ok('reply to an imported email threads',r.body.sparkId==='imp1'&&r.body.threaded,r.body);
// paging
const many=Array.from({length:450},(_,i)=>({coll:'sessions',item:{id:'s'+i,notes:'x',updated:t}}));
await call(sync,{code:'secret-code',since:0,push:many});
let since=0,got=0,more=true,loops=0;while(more&&loops<10){const q=await call(sync,{code:'secret-code',since,push:[]});got+=q.body.items.length;since=q.body.next;more=q.body.more;loops++}
ok('paging returns everything',got>=454,got);
// quote stripping
ok('gmail quote stripped',stripQuoted("hi there\n\nOn Mon, 5 Oct 2026 at 10:00, Marcelo <m@x> wrote:\n> old")==='hi there');
ok('pt quote stripped',stripQuoted("oi\n\nEm seg., 5 de out. de 2026 às 10:00, Marcelo escreveu:\n> velho")==='oi');
ok('html fallback',parseInbound({headers:{},html:"<p>Hello<br>World</p>"}).body==='Hello\nWorld');
srv.close();
