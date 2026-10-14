'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..'); let count = 0;
function walk(dir) {
  for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
    if(item.name === 'node_modules') continue;
    const file = path.join(dir,item.name);
    if(item.isDirectory()) walk(file);
    else if(file.endsWith('.json')) { JSON.parse(fs.readFileSync(file,'utf8')); count++; }
    else if(file.endsWith('.js') || file.endsWith('.mjs')) { cp.execFileSync(process.execPath,['--check',file],{stdio:'pipe'}); count++; }
  }
}
walk(root);
const app = JSON.parse(fs.readFileSync(path.join(root,'miniprogram/app.json')));
for(const page of app.pages) for(const ext of ['.js','.wxml','.wxss']) if(!fs.existsSync(path.join(root,'miniprogram',page+ext))) throw new Error(`页面缺少文件：${page+ext}`);
for(const fn of ['appointmentApi','reminderWorker']) for(const file of fs.readdirSync(path.join(root,'backend'))) {
  if(fs.readFileSync(path.join(root,'backend',file),'utf8') !== fs.readFileSync(path.join(root,'cloudfunctions',fn,'lib',file),'utf8')) throw new Error('云函数公共代码过期，请运行 npm run prepare:cloud');
}
console.log(`通过 ${count} 个代码与配置文件检查，页面和云函数打包完整。`);
