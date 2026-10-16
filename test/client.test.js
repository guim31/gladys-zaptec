// -----------------------------------------------------------------------------
// The Zaptec API client (src/zaptec/client.js) against the fake Zaptec cloud.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZaptecError,
  accountKey,
  createZaptecClient,
  memoryTokenStore,
  retryAfterMs,
} from '../src/zaptec/client.js';
import {
  ACCOUNT,
  GO,
  INSTALLATION,
  OTHER_INSTALLATION,
  createFakeZaptec,
} from './helpers/fakeZaptec.js';

function setup({ password = ACCOUNT.password, tokenStore = memoryTokenStore() } = {}) {
  const zaptec = createFakeZaptec();
  const clock = { now: Date.parse('2026-10-14T18:43:00Z') };
  const client = createZaptecClient({
    username: ACCOUNT.username,
    password,
    fetch: zaptec.fetch,
    tokenStore,
    now: () => clock.now,
  });
  return { zaptec, client, clock, tokenStore };
}

test('logs in with the password grant once, then sends the token with every call', async () => {
  const { zaptec, client } = setup();
  const chargers = await client.getChargers();
  assert.equal(chargers.length, 2);
  await client.getChargerState(GO);
  assert.deepEqual(zaptec.paths(), ['/oauth/token', '/api/chargers', `/api/chargers/${GO}/state`]);
  assert.deepEqual(zaptec.requests[0].form, {
    grant_type: 'password',
    username: ACCOUNT.username,
    password: ACCOUNT.password,
  });
  assert.equal(zaptec.requests[0].auth, undefined, 'no token on the login');
  assert.equal(zaptec.requests[1].auth, 'Bearer token-1');
});

test('refused credentials are an auth error, without the password in the message', async () => {
  const { zaptec, client } = setup({ password: 'wrong password' });
  await assert.rejects(client.getChargers(), (err) => {
    assert.ok(err instanceof ZaptecError);
    assert.equal(err.kind, 'auth');
    assert.equal(err.status, 400);
    assert.ok(!err.message.includes('wrong password'));
    return true;
  });
  assert.deepEqual(zaptec.paths(), ['/oauth/token']);
});

test('an expired token logs in again before the call, a 401 logs in again once', async () => {
  const { zaptec, client, clock } = setup();
  await client.getChargers();
  clock.now += 24 * 60 * 60 * 1000;
  await client.getChargers();
  assert.equal(zaptec.paths().filter((p) => p === '/oauth/token').length, 2);

  zaptec.validTokens.clear();
  await client.getChargers();
  assert.equal(zaptec.paths().filter((p) => p === '/oauth/token').length, 3);
});

test('a saved token of the same account is reused, not the one of another account', async () => {
  const tokenStore = memoryTokenStore();
  const first = setup({ tokenStore });
  await first.client.getChargers();
  const saved = await tokenStore.load();
  assert.equal(saved.account, accountKey(ACCOUNT.username));
  assert.ok(!JSON.stringify(saved).includes(ACCOUNT.password), 'no password in /data');

  const second = setup({ tokenStore });
  second.zaptec.validTokens.add(saved.accessToken);
  await second.client.getChargers();
  assert.deepEqual(second.zaptec.paths(), ['/api/chargers']);

  await tokenStore.save({ ...saved, account: accountKey('someone@example.com') });
  const third = setup({ tokenStore });
  await third.client.getChargers();
  assert.equal(third.zaptec.paths()[0], '/oauth/token');
});

test('an installation the account may not read is null, not an error', async () => {
  const { zaptec, client } = setup();
  assert.equal((await client.getInstallation(INSTALLATION)).MaxCurrent, 40);
  assert.equal(await client.getInstallation(OTHER_INSTALLATION), null);
  // Since 2025 Zaptec may also answer an empty 204.
  zaptec.fail.push({ path: /installation/, status: 204, body: null });
  assert.equal(await client.getInstallation(INSTALLATION), null);
});

test('commands use the documented ids, settings the documented update', async () => {
  const { zaptec, client } = setup();
  await client.command(GO, 'stop_charging_final');
  await client.command(GO, 'resume_charging');
  await client.setAvailableCurrent(INSTALLATION, 20);
  assert.deepEqual(zaptec.paths('POST').slice(1), [
    `/api/chargers/${GO}/sendCommand/506`,
    `/api/chargers/${GO}/sendCommand/507`,
    `/api/installation/${INSTALLATION}/update`,
  ]);
  assert.deepEqual(zaptec.requests.at(-1).body, { availableCurrent: 20 });
  await assert.rejects(() => client.command(GO, 'authorize_charge'), /Unknown Zaptec command/);
});

test('errors are typed: rate limit with its delay, refusal, outage, network', async () => {
  const { zaptec, client } = setup();
  await client.connect();
  const cases = [
    [{ status: 429, headers: { 'retry-after': '30' } }, 'rate_limit'],
    [{ status: 400 }, 'refused'],
    [{ status: 403 }, 'forbidden'],
    [{ status: 503 }, 'server'],
    [{ network: true }, 'network'],
  ];
  for (const [failure, kind] of cases) {
    zaptec.fail.push(failure);
    await assert.rejects(client.getChargerState(GO), (err) => {
      assert.equal(err.kind, kind);
      if (kind === 'rate_limit') {
        assert.equal(err.retryAfterMs, 30000);
      }
      return true;
    });
  }
});

test('Retry-After reads seconds and HTTP dates', () => {
  const now = Date.parse('2026-10-14T18:43:00Z');
  assert.equal(retryAfterMs('120', now), 120000);
  assert.equal(retryAfterMs('Wed, 14 Oct 2026 18:44:00 GMT', now), 60000);
  assert.equal(retryAfterMs(null, now), undefined);
  assert.equal(retryAfterMs('soon', now), undefined);
});
