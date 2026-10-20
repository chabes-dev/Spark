import http from "http";import fs from "fs";import { startMock } from "./mockredis.mjs";
await startMock(8799);
Object.assign(process.env,{UPSTASH_REDIS_REST_URL:"http://localhost:8799",UPSTASH_REDIS_REST_TOKEN:"t",SPARK_SYNC_CODE:"secret-code",INBOUND_KEY:"ik",SPARK_EMAIL:"spark123@cloudmailin.net",ALLOWED_SENDERS:"me@example.com",GEMINI_API_KEY:"test-fake"});
// the AI is "on" but Gemini is faked as busy, so tests never reach Google (browser tests fake /api/classify themselves)
const realFetch=globalThis.fetch;globalThis.fetch=(u,o)=>String(u).includes("generativelanguage")?Promise.resolve(new Response('{"error":{"code":503}}',{status:503})):realFetch(u,o);
const routes={};for(const n of ["sync","inbound","classify","related"])routes[n]=(await import(`../api/${n}.js`)).default;
http.createServer((req,res)=>{
  const u=new URL(req.url,"http://x");
  if(u.pathname.startsWith("/api/")){let b="";req.on("data",d=>b+=d);req.on("end",async()=>{
    const shim={status(c){res.statusCode=c;return shim},setHeader(k,v){res.setHeader(k,v);return shim},json(j){res.setHeader("content-type","application/json");res.end(JSON.stringify(j))}};
    await routes[u.pathname.slice(5)]({method:req.method,body:b?JSON.parse(b):{},query:Object.fromEntries(u.searchParams)},shim)});return}
  res.setHeader("content-type",u.pathname.endsWith(".png")?"image/png":"text/html");
  res.end(fs.readFileSync(u.pathname==="/"?"index.html":"."+u.pathname));
}).listen(8800,()=>console.log("up"));
