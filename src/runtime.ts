import { ChildProcess, spawn } from 'child_process';
import path from 'path';

type ProcessSpec = {
  name: string;
  script: string;
};

const processes: ProcessSpec[] = [
  { name: 'web', script: path.join(__dirname, 'app.js') },
  { name: 'webhook-worker', script: path.join(__dirname, 'workers', 'webhook-worker.js') },
  { name: 'outbox-worker', script: path.join(__dirname, 'workers', 'outbox-worker.js') },
];

const children = new Map<string, ChildProcess>();
let shuttingDown = false;

function terminateAll(signal: NodeJS.Signals): void {
  for (const [name, child] of children.entries()) {
    if (child.exitCode === null && child.signalCode === null) {
      console.log(`[runtime] forwarding ${signal} to ${name}`);
      child.kill(signal);
    }
  }
}

function shutdown(signal: NodeJS.Signals, exitCode: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[runtime] shutting down after ${signal}`);
  terminateAll(signal);

  const forceTimer = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 10_000);
  forceTimer.unref();

  const checkDone = setInterval(() => {
    const anyAlive = [...children.values()].some(child => child.exitCode === null && child.signalCode === null);
    if (!anyAlive) {
      clearInterval(checkDone);
      process.exit(exitCode);
    }
  }, 100);
}

for (const spec of processes) {
  const child = spawn(process.execPath, [spec.script], {
    env: process.env,
    stdio: 'inherit',
  });
  children.set(spec.name, child);
  console.log(`[runtime] started ${spec.name} (pid=${child.pid ?? 'unknown'})`);

  child.on('error', error => {
    console.error(`[runtime] ${spec.name} failed to start:`, error);
    shutdown('SIGTERM', 1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    console.error(`[runtime] ${spec.name} exited unexpectedly (${reason}); restarting the whole service.`);
    shutdown('SIGTERM', code && code > 0 ? code : 1);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM', 0));
process.on('SIGINT', () => shutdown('SIGINT', 0));
