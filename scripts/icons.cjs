const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs/promises');
async function main() {
  const { default: pngToIco } = await import('png-to-ico');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(sizes.map(size => sharp(path.resolve('build/icon.svg')).resize(size, size).png().toBuffer()));
  await fs.writeFile('build/icon.ico', await pngToIco(buffers));
  await fs.writeFile('build/icon.png', buffers.at(-1));
  console.log('App icons generated');
}
void main();
