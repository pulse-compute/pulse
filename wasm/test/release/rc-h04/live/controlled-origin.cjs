const http=require('node:http');
let count=0;const timers=new Set();
const s=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://origin');
  if(url.pathname==='/counts'){res.setHeader('content-type','application/json');res.end(JSON.stringify({count}));return;}
  count++;console.log(JSON.stringify({number:count,method:req.method,path:url.pathname}));
  let n=0;req.on('data',b=>{n+=b.length;if(n>65536)req.destroy();});
  req.on('end',()=>{
    const send=()=>{res.writeHead(202,{'x-ack':'accepted','x-observed-method':req.method,'cache-control':'no-store'});res.end('origin-'+req.method);};
    if(url.pathname==='/reset'){req.socket.destroy();return;}
    if(url.pathname==='/slow'){const t=setTimeout(()=>{timers.delete(t);send();},1800);timers.add(t);return;}
    if(url.pathname==='/body'){res.writeHead(202,{'x-ack':'accepted','cache-control':'no-store'});res.flushHeaders();const t=setTimeout(()=>{timers.delete(t);res.end('late-body');},1800);timers.add(t);return;}
    send();
  });
});s.listen(18716,'127.0.0.1');
process.on('SIGTERM',()=>{for(const t of timers)clearTimeout(t);s.closeAllConnections();s.close(()=>process.exit(0));});
