import { build } from 'vite';
import { readdir, readFile, rm } from 'node:fs/promises';

const sentinel = 'NONSECRET_BUILD_CREDENTIAL_CANARY_7429';
const outDir = 'work/credential-check';
process.env.VITE_HF_TOKEN = sentinel;
try {
  await build({build: {outDir}});
  async function inspect(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await inspect(path);
      else {
        const content = await readFile(path);
        for (const value of [sentinel, 'VITE_HF_TOKEN']) {
          if (content.includes(Buffer.from(value))) throw new Error('Build credential mechanism found in emitted assets');
        }
      }
    }
  }
  await inspect(outDir);
  console.log('PASS: emitted assets contain neither nonsecret sentinel nor VITE_HF_TOKEN');
} finally {
  delete process.env.VITE_HF_TOKEN;
  await rm(outDir, {recursive: true, force: true});
}
