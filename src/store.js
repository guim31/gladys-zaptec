// -----------------------------------------------------------------------------
// The Zaptec token, kept in /data (the only writable volume of the container).
//
// One small JSON file: the access token of the account and when it expires,
// tagged with a fingerprint of the account (never the address itself) so a new
// account in the configuration starts over. The password is never written
// here: it stays in the Gladys configuration.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || '/data';

/**
 * @param {{ dir?: string }} [options]
 */
export function createTokenStore({ dir = DATA_DIR } = {}) {
  const file = join(dir, 'zaptec-token.json');
  return {
    async load() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8'));
        return data && typeof data === 'object' ? data : null;
      } catch {
        return null;
      }
    },
    async save(token) {
      await mkdir(dir, { recursive: true });
      // Written then renamed: a crash never leaves half a file behind.
      const temp = `${file}.tmp`;
      await writeFile(temp, JSON.stringify(token), { mode: 0o600 });
      await rename(temp, file);
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}
