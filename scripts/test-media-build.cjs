/* eslint-disable @typescript-eslint/no-require-imports */
// Worker smoke checks only; HTTP verification lives in verify-gallery-packaged-upload.ts.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const inside = (base, target) => target.startsWith(base + path.sep);
async function runWorker(root, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'src/lib/media/image-worker.cjs')], { cwd: root, windowsHide: true, env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let result, failure, stderr = '';
    const timer = setTimeout(() => { failure = new Error('Packaged worker timed out'); child.kill('SIGKILL'); }, 10000);
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.on('message', message => { if (message.error) failure = new Error(message.error); else if (message.bytes) result = Buffer.from(message.bytes, 'base64'); });
    child.on('error', error => { failure = error; });
    child.on('close', code => { clearTimeout(timer); if (failure) reject(failure); else if (code !== 0 || !result) reject(new Error('Packaged worker failed: ' + stderr)); else resolve(result); });
    child.send({ bytes: input.toString('base64'), mime: 'image/png' }, error => { if (error) failure = error; });
  });
}
async function main() {
  const checkout = path.resolve(__dirname, '..');
  const input = await sharp({ create: { width: 2, height: 3, channels: 3, background: 'red' } }).png().toBuffer();
  for (const route of ['api/media/upload', 'api/v1/admin/catalog/products/[id]/images']) {
    const tracePath = path.join(checkout, '.next/server/app', route, 'route.js.nft.json');
    const trace = JSON.parse(await fs.readFile(tracePath, 'utf8'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'media-built-smoke-'));
    assert.ok(inside(path.resolve(os.tmpdir()), root));
    try {
      const sources = [...trace.files.map(file => path.resolve(path.dirname(tracePath), file)), tracePath, tracePath.replace('.nft.json', '')];
      assert.ok(sources.includes(path.join(checkout, 'src/lib/media/image-worker.cjs')), 'Worker must be traced');
      assert.ok(sources.some(file => file.includes(path.join('node_modules', '@img')) && file.endsWith('.node')), 'Native Sharp runtime must be traced');
      for (const source of sources) {
        assert.ok(inside(checkout, source), 'Trace escapes checkout');
        const destination = path.resolve(root, path.relative(checkout, source));
        assert.ok(inside(root, destination), 'Trace escapes deployment');
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
      }
      const output = await runWorker(root, input);
      const metadata = await sharp(output).metadata();
      assert.equal(metadata.width, 2); assert.equal(metadata.height, 3); assert.equal(metadata.format, 'png');
      await fs.unlink(path.join(root, 'src/lib/media/image-worker.cjs'));
      await assert.rejects(runWorker(root, input), /Cannot find module.*image-worker\.cjs/s);
      console.log(JSON.stringify({ route, tracedFilesCopied: sources.length, isolatedWorker: 'passed', missingWorkerRejected: true, width: 2, height: 3 }));
    } finally {
      assert.ok(inside(path.resolve(os.tmpdir()), root), 'Unsafe cleanup root');
      await fs.rm(root, { recursive: true, force: true });
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
