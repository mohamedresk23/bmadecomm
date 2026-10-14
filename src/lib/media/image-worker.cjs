// Child entry point intentionally uses CommonJS for execution by plain Node.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp');
process.once('message', async ({ bytes, mime }) => {
  try {
    const input = Buffer.from(bytes, 'base64');
    const options = { limitInputPixels: 8000000, failOn: 'warning', unlimited: false };
    const meta = await sharp(input, { ...options, limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || meta.width * meta.height > 8000000 || (meta.pages || 1) !== 1) {
      process.send({ error: 'IMAGE_POLICY' }, () => process.exit(0));
      return;
    }
    const format = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
    if (meta.format !== format) throw new Error('format');
    const result = await sharp(input, options).rotate().toFormat(format).toBuffer();
    process.send({ bytes: result.toString('base64'), peakRssKiB: process.resourceUsage().maxRSS }, () => process.exit(0));
  } catch {
    process.send({ error: 'INVALID_IMAGE' }, () => process.exit(0));
  }
});
