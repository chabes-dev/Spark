import http from "http";
export function startMock(port){
  const H={},Z={},SETS={};
  const h=k=>(H[k]||={}), z=k=>(Z[k]||={}), st=k=>(SETS[k]||=new Set());
  function run(c){
    const [cmd,...a]=c;const C=cmd.toUpperCase();
    if(C==="HGET")return h(a[0])[a[1]]??null;
    if(C==="HSET"){for(let i=1;i<a.length;i+=2)h(a[0])[a[i]]=a[i+1];return 1}
    if(C==="HSETNX"){if(h(a[0])[a[1]]!==undefined)return 0;h(a[0])[a[1]]=a[2];return 1}
    if(C==="HMGET")return a.slice(1).map(k=>h(a[0])[k]??null);
    if(C==="ZADD"){z(a[0])[a[2]]=+a[1];return 1}
    if(C==="ZRANGEBYSCORE"){const [k,min,max,ws,lim,off,cnt]=a;const lo=min.startsWith("(")?+min.slice(1):+min;const ex=min.startsWith("(");
      let rows=Object.entries(z(k)).filter(([m,s])=>ex?s>lo:s>=lo).sort((x,y)=>x[1]-y[1]).slice(+off,+off+ +cnt);return rows.flatMap(([m,s])=>[m,String(s)])}
    if(C==="SADD"){a.slice(1).forEach(x=>st(a[0]).add(x));return 1}
    if(C==="SMEMBERS")return [...st(a[0])];
    throw new Error("unknown "+C);
  }
  const srv=http.createServer((req,res)=>{let b="";req.on("data",d=>b+=d);req.on("end",()=>{
    const body=JSON.parse(b);let out;
    try{out=req.url.endsWith("/pipeline")?body.map(c=>({result:run(c)})):{result:run(body)}}catch(e){out={error:e.message}}
    res.setHeader("content-type","application/json");res.end(JSON.stringify(out))})});
  return new Promise(r=>srv.listen(port,()=>r({srv,H,Z})));
}
