'use strict';
// Bounded qualification fixture, not a production WebSocket server.
const http=require('node:http'),crypto=require('node:crypto');
function createOrigin(onRequest=()=>{},onHold=()=>{}){
  const origin = http.createServer((req, res) => {
    onRequest();
    if (req.headers['x-pulse-terminal-hold']) { onHold(); res.setHeader('Grip-Hold', 'response'); res.setHeader('Grip-Channel', req.headers['x-pulse-terminal-hold']); res.setHeader('Grip-Timeout', '10'); res.end('timed-out'); }
    else res.end('terminal-origin');
  });

  origin.on('upgrade', (req, socket) => {
    onRequest();
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    let buffer = Buffer.alloc(0);
    socket.on('error',()=>{});
    socket.on('data',bytes=>{
      buffer=Buffer.concat([buffer,bytes]);if(buffer.length>4096)return socket.destroy();
      while(buffer.length>=2){const n=buffer[1]&127;if(n>125||!(buffer[1]&128))return socket.destroy();if(buffer.length<6+n)return;
        const opcode=buffer[0]&15;if(opcode===8)return socket.end(Buffer.from([0x88,0]));if(opcode!==1||!(buffer[0]&128))return socket.destroy();
        const payload=Buffer.from(buffer.subarray(6,6+n).map((b,i)=>b^buffer[2+i%4]));buffer=buffer.subarray(6+n);socket.write(Buffer.concat([Buffer.from([0x81,payload.length]),payload]));}
    });
  });
  return origin;
}
if(require.main===module){const port=Number(process.argv[2]||8080);createOrigin().listen(port,'127.0.0.1',()=>console.log('Terminal fixture listening on loopback port '+port));}
module.exports={createOrigin};
