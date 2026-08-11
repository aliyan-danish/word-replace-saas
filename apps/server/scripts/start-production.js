// Production entrypoint for free single-service hosts (e.g. Koyeb): run the BullMQ
// worker in-process alongside the Express API so replace jobs still complete without
// a separate Background Worker service (those usually require a paid plan / card).
//
// Locally, keep using two terminals: `npm run dev` + `npm run worker`.
require('dotenv').config();

const { spawn } = require('child_process');
const path = require('path');

const workerPath = path.join(__dirname, '..', 'workers', 'replace.worker.js');
const worker = spawn(process.execPath, [workerPath], {
  stdio: 'inherit',
  env: process.env,
});

worker.on('exit', (code, signal) => {
  // If the worker dies, take the web process down too so the host restarts both.
  console.error(
    `[start-production] worker exited (code=${code}, signal=${signal}). Stopping API.`
  );
  process.exit(code || 1);
});

process.on('SIGTERM', () => {
  worker.kill('SIGTERM');
});
process.on('SIGINT', () => {
  worker.kill('SIGINT');
});

require('../index.js');
