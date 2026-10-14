'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const name of ['appointmentApi', 'reminderWorker']) {
  const dest = path.join(root, 'cloudfunctions', name, 'lib'); fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(path.join(root, 'backend')).filter(f => f.endsWith('.js'))) fs.copyFileSync(path.join(root, 'backend', file), path.join(dest, file));
}
console.log('云函数公共代码已打包。');
