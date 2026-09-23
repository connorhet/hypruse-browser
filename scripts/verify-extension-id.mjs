// Recomputes the extension ID from the public key in dist/manifest.json and fails the build
// when it is not the ID the native host manifest allows.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const EXPECTED_ID = 'pcfjlemgcbbpppclachnobhnnnahpgoj';

function extensionIdFromKey(key) {
  const digest = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex');
  return [...digest.slice(0, 32)]
    .map((hex) => String.fromCharCode('a'.charCodeAt(0) + parseInt(hex, 16)))
    .join('');
}

const manifest = JSON.parse(readFileSync(new URL('../dist/manifest.json', import.meta.url)));
const id = extensionIdFromKey(manifest.key);
if (id !== EXPECTED_ID) {
  console.error(`extension id is ${id}, expected ${EXPECTED_ID}`);
  process.exit(1);
}
console.log(`extension id ${id}`);
