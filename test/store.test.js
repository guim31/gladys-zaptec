// -----------------------------------------------------------------------------
// The token file in /data (src/store.js), in a temporary directory.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTokenStore } from '../src/store.js';

test('saves, reloads and clears the token, readable by the owner only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-zaptec-'));
  try {
    const store = createTokenStore({ dir: join(dir, 'nested') });
    assert.equal(await store.load(), null);
    const token = { account: 'abc', accessToken: 'a', expiresAt: 1 };
    await store.save(token);
    assert.deepEqual(await store.load(), token);
    const file = join(dir, 'nested', 'zaptec-token.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await store.clear();
    assert.equal(await store.load(), null);

    // A damaged file is ignored, not fatal.
    await writeFile(file, '{ not json');
    assert.equal(await store.load(), null);
    assert.equal(await readFile(file, 'utf8'), '{ not json');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
