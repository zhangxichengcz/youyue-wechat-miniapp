'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../free-backend');
const files = ['core.mjs', 'auth.mjs', 'reminders.mjs', 'worker.mjs'];
const parts = files.map(file => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/^import\s+.*?;\s*$/gm, '')
    .replace(/\bexport\s+(?=(?:const|let|class|function|async\s+function)\b)/g, '');
  return `// Source: ${file}\n${source.trim()}`;
});
const destination = path.join(root, 'worker-dashboard.mjs');
fs.writeFileSync(destination, '// Generated for the Cloudflare dashboard. Edit source modules and rebuild.\n\n'+parts.join('\n\n')+'\n');
cp.execFileSync(process.execPath, ['--check', destination], { stdio: 'pipe' });
// Console 的单行输入框可能合并换行；去掉注释再折叠，避免 -- 吞掉后续语句。
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('--')).join(' ');
fs.writeFileSync(path.join(root, 'schema-console.sql'), schema+'\n');
console.log('已生成可直接粘贴到 Cloudflare 网页编辑器的后台文件。');
