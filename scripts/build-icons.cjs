// Run with Electron for its native image encoder. No window or external dependency is required.
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
app.setPath('userData', path.join(root, '.local', 'icon-export-user-data'));

try {
  const source = nativeImage.createFromPath(path.join(root, 'assets', 'icon', 'opentypora.png'));
  if (source.isEmpty()) throw new Error('The source icon could not be decoded');
  const dimensions = source.getSize();
  if (dimensions.width !== dimensions.height || dimensions.width < 256) throw new Error('The source icon must be square and at least 256 pixels');
  const png = size => source.resize({ width: size, height: size, quality: 'best' }).toPNG();
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public', 'app-icon.png'), png(256));
  fs.writeFileSync(path.join(root, 'public', 'favicon.png'), png(64));

  // ICO permits embedded PNG frames, including the 256px Windows Explorer frame.
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
  const frames = sizes.map(png);
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frames[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frames[index].length;
  });
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), Buffer.concat([header, ...frames]));
  console.log(JSON.stringify({ source: dimensions, png: [256, 64], ico: sizes }));
  app.exit(0);
} catch (error) {
  console.error(error);
  app.exit(1);
}
