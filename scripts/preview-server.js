'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../preview');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
const server = http.createServer((req,res) => {
  if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405);res.end();return;}
  let pathname;try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch(_){res.writeHead(400);res.end();return;}
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
  res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
});
server.listen(4173,'127.0.0.1',()=>console.log('交互演示：http://127.0.0.1:4173'));
