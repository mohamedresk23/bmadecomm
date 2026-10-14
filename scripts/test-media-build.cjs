/* eslint-disable @typescript-eslint/no-require-imports */
// Verification only: package the existing upload trace without checkout fallback.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const sharp = require('sharp');

async function main() {
  const checkout = path.resolve(__dirname, '..');
  const tracePath = path.join(checkout, '.next/server/app/api/media/upload/route.js.nft.json');
  const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-built-smoke-'));
  const inside = (base, target) => target.startsWith(base + path.sep);
  if (!inside(path.resolve(os.tmpdir()), path.resolve(root))) throw new Error('Unsafe deployment root');
  try {
    const sources = [...trace.files.map(file => path.resolve(path.dirname(tracePath), file)), tracePath, tracePath.replace('.nft.json', '')];
    for (const source of sources) {
      if (!inside(checkout, source)) throw new Error('Trace escapes checkout');
      const destination = path.resolve(root, path.relative(checkout, source));
      if (!inside(root, destination)) throw new Error('Trace escapes deployment');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    const worker = path.resolve(root, 'src/lib/media/image-worker.cjs');
    await fs.access(worker);
    const input = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } }).png().toBuffer();
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker], { cwd: root, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      let result; let failure; let stderr = '';
      const timer = setTimeout(() => { failure = new Error('Packaged worker timed out'); child.kill('SIGKILL'); }, 10000);
      child.stderr.on('data', bytes => { stderr += bytes; });
      child.on('message', message => { if (message.error) failure = new Error(message.error); else if (message.bytes) result = Buffer.from(message.bytes, 'base64'); });
      child.on('error', error => { failure = error; });
      child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code !== 0 || !result) reject(new Error('Packaged worker failed: ' + stderr)); else resolve(result); });
      child.send({ bytes: input.toString('base64'), mime: 'image/png' });
    });
    if (!output.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || output.readUInt32BE(16) !== 2 || output.readUInt32BE(20) !== 3) throw new Error('Invalid packaged PNG result');
    console.log(JSON.stringify({ result: 'passed', tracedFilesCopied: sources.length, worker: 'src/lib/media/image-worker.cjs', cwd: 'isolated temporary deployment', inputBytes: input.length, outputBytes: output.length, width: 2, height: 3 }));
  } finally {
    if (!inside(path.resolve(os.tmpdir()), path.resolve(root))) throw new Error('Unsafe cleanup root');
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
