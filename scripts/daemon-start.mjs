// دایمون دوفورک — فرزند از والد جدا می‌شود (setsid + unref) تا کشنده‌ی
// پروسه‌های پس‌زمینه‌ی سندباکس بعد از پایان دستور، درخت را پیدا نکند.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

const log = openSync('/home/z/my-project/repos/megan-back/server.log', 'a');
const child = spawn(process.execPath, ['dist/main.js'], {
  cwd: '/home/z/my-project/repos/megan-back',
  detached: true,
  stdio: ['ignore', log, log],
  env: process.env,
});
child.unref();
console.log('daemon pid:', child.pid);
