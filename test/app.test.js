// -----------------------------------------------------------------------------
// The integration end to end: the SDK's fake Gladys on one side, the fake
// Zaptec cloud on the other (test/helpers), the app between them as index.js
// wires it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HEARTBEAT_MS, INSTALLATION_PERIOD_MS, WIDGET_KEY } from '../src/app.js';
import { CHARGING_STATE, CONNECTOR_STATUS } from '../src/zaptec/model.js';
import { ACCOUNT, GO, INSTALLATION, PRO, fixture, withObservations } from './helpers/fakeZaptec.js';
import { createWorld } from './helpers/world.js';

const MINUTE = 60 * 1000;
const C = 'charger';
const I = 'installation';

function feature(world, type, id, key) {
  const device = world.device(type, id);
  return device.features.find(
    (f) => f.external_id === world.gladys.externalIds(type, id).feature(key),
  );
}

const stateReads = (world, id) =>
  world.zaptec.paths().filter((p) => p === `/api/chargers/${id}/state`).length;

test('publishes a device per charger and per installation it may read, then their states', async () => {
  const world = await createWorld();
  const names = world.gladys.fake.discoveredDevices.map((d) => `${d.name} (${d.model})`);
  assert.deepEqual(names, [
    'Garage (Zaptec Go)',
    'Parking (Zaptec Pro)',
    'Maison (Zaptec installation)',
  ]);
  assert.deepEqual(world.gladys.fake.connectionStatus, { connected: true });

  assert.equal(world.state(C, GO, 'connector'), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(world.state(C, GO, 'charging_state'), CHARGING_STATE.CHARGING);
  assert.equal(world.state(C, GO, 'status'), 'En charge');
  assert.equal(world.state(C, GO, 'power'), 10912);
  assert.equal(world.state(C, GO, 'current_l1'), 15.8);
  assert.equal(world.state(C, GO, 'session_energy'), 7.421);
  assert.equal(world.state(C, GO, 'total_energy'), 4821.337);
  assert.equal(world.state(C, GO, 'charge'), 1);

  assert.equal(world.state(C, PRO, 'connector'), CONNECTOR_STATUS.AVAILABLE);
  assert.equal(world.state(C, PRO, 'charging_state'), CHARGING_STATE.IDLE);
  assert.equal(world.state(C, PRO, 'status'), 'Aucun véhicule');
  assert.equal(world.state(C, PRO, 'total_energy'), 2210.418);

  assert.equal(world.state(I, INSTALLATION, 'available_current'), 25);
  assert.equal(world.state(I, INSTALLATION, 'max_current'), 40);
  // The available current goes up to the fuse of the installation.
  assert.equal(feature(world, I, INSTALLATION, 'available_current').max, 40);
  assert.deepEqual(
    world.gladys.fake.transports.map((t) => t.transport),
    ['cloud', 'cloud', 'cloud'],
  );
});

test('the feature names follow the configured language', async () => {
  const world = await createWorld({ config: { language: 'de' } });
  assert.equal(feature(world, C, GO, 'session_energy').name, 'Energie der Ladung');
  assert.equal(feature(world, I, INSTALLATION, 'available_current').name, 'Verfügbarer Strom');
  assert.equal(world.state(C, GO, 'status'), 'Lädt');
});

test('nothing is read for a device the user did not add', async () => {
  const world = await createWorld({ created: false });
  assert.equal(world.gladys.fake.discoveredDevices.length, 3);
  assert.equal(world.gladys.fake.states.length, 0);
  assert.ok(!world.zaptec.paths().some((p) => p.endsWith('/state')));
});

test('the states refresh on the container timer, without any onPoll from the core', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-14T18:43:00Z') });
  const world = await createWorld({ timers: true });
  const polls = world.gladys.fake.wsMessages.filter((m) => m.type === 'poll');
  world.zaptec.states[GO] = withObservations(world.zaptec.states[GO], { 513: '7200.0' });

  const period = Number(world.app.config.poll_interval) * 1000;
  world.advance(period);
  t.mock.timers.tick(period);
  // Let the cycle of the timer run its requests.
  for (let i = 0; i < 50 && world.state(C, GO, 'power') !== 7200; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(world.state(C, GO, 'power'), 7200);
  assert.equal(polls.length, 0, 'the core never asked');
  world.app.stop();
});

test('one reading per charger and period, the installation every ten minutes', async () => {
  const world = await createWorld({ config: { poll_interval: '60' } });
  const installationReads = () =>
    world.zaptec.paths().filter((p) => p === `/api/installation/${INSTALLATION}`).length;
  const before = { go: stateReads(world, GO), installation: installationReads() };
  for (let i = 0; i < 10; i += 1) {
    world.advance(MINUTE);
    await world.app.cycle();
  }
  assert.equal(stateReads(world, GO), before.go + 10);
  assert.equal(installationReads(), before.installation + 1);
  assert.ok(INSTALLATION_PERIOD_MS >= 10 * MINUTE);
});

test('only the changes are published, and an unchanged value again after the heartbeat', async () => {
  const world = await createWorld();
  const count = () => world.gladys.fake.states.length;
  const before = count();

  world.advance(5 * MINUTE);
  await world.app.cycle();
  assert.equal(count(), before, 'nothing changed, nothing sent');

  world.zaptec.states[GO] = withObservations(world.zaptec.states[GO], { 513: '11040.0' });
  world.advance(5 * MINUTE);
  await world.app.cycle();
  assert.equal(count(), before + 1);
  assert.equal(world.state(C, GO, 'power'), 11040);

  // The heartbeat of the SDK uses the real clock: six hours later, everything again.
  const realNow = Date.now;
  Date.now = () => realNow() + HEARTBEAT_MS + MINUTE;
  try {
    world.advance(5 * MINUTE);
    await world.app.cycle();
  } finally {
    Date.now = realNow;
  }
  assert.ok(count() >= before + 1 + 20, 'every value of the chargers re-sent after the heartbeat');
  assert.ok(HEARTBEAT_MS <= 12 * 60 * MINUTE);
});

test('a device the user adds gets all its states again, and the widget is refreshed', async () => {
  const world = await createWorld();
  const device = world.device(C, GO);
  const before = world.gladys.fake.states.length;
  await world.gladys.fake.deviceCreated(device);
  const sent = world.gladys.fake.states.slice(before).map((s) => s.device_feature_external_id);
  assert.equal(sent.length, 10, 'every feature of the charger');
  assert.ok(world.gladys.fake.widgetRefreshes.includes(WIDGET_KEY));
});

test('the core poll is only a fallback: skipped while the timer keeps up', async () => {
  const world = await createWorld();
  const before = stateReads(world, GO);
  assert.deepEqual(await world.gladys.fake.poll(world.device(C, GO)), { success: true });
  assert.equal(stateReads(world, GO), before);
  world.advance(2 * MINUTE);
  await world.gladys.fake.poll(world.device(C, GO));
  assert.equal(stateReads(world, GO), before + 1, 'the timer stalled: the core poll reads');
});

test('a normal cycle writes nothing at info level, and no secret ever reaches the logs', async () => {
  const world = await createWorld();
  for (let i = 0; i < 3; i += 1) {
    world.advance(2 * MINUTE);
    world.zaptec.states[GO] = withObservations(world.zaptec.states[GO], {
      513: String(10000 + i),
      553: String(8 + i),
    });
    await world.app.cycle();
  }
  assert.deepEqual(world.logger.at('info'), [
    'Connected to Zaptec: 2 charger(s), 1 installation(s) with current control',
  ]);
  assert.deepEqual(world.logger.at('warn'), []);

  // Errors of every kind, then commands: still no secret.
  world.zaptec.fail.push({ path: /state$/, status: 503 }, { network: true });
  world.advance(2 * MINUTE);
  await world.app.cycle();
  world.advance(2 * MINUTE);
  await world.app.cycle();
  await world.gladys.fake.setValue(
    world.device(I, INSTALLATION),
    feature(world, I, INSTALLATION, 'available_current'),
    16,
  );
  await world.gladys.fake.setValue(world.device(C, GO), feature(world, C, GO, 'charge'), 0);
  const everything = world.logger.lines.map((l) => l.message).join('\n');
  for (const secret of [ACCOUNT.password, 'token-', ACCOUNT.username]) {
    assert.ok(!everything.includes(secret), `"${secret}" leaked into the logs`);
  }
  const requestsWithSecret = world.gladys.fake.requests.filter((r) =>
    JSON.stringify(r.body ?? '').includes(ACCOUNT.password),
  );
  assert.deepEqual(requestsWithSecret, [], 'the password never goes to Gladys');
});

test('a cloud outage is said once, and its end once', async () => {
  const world = await createWorld();
  world.logger.clear();
  for (let i = 0; i < 3; i += 1) {
    world.zaptec.fail.push({ network: true });
    world.advance(2 * MINUTE);
    await world.app.cycle();
  }
  assert.equal(world.logger.at('warn').length, 1);
  assert.match(world.logger.at('warn')[0], /Zaptec cloud unreachable/);
  assert.equal(world.gladys.fake.connectionStatus.connected, false);

  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.deepEqual(world.logger.at('info'), ['Zaptec cloud reachable again']);
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('a charger going offline shows unavailable and the cloud badge turns unreachable', async () => {
  const world = await createWorld();
  world.logger.clear();
  world.zaptec.states[GO] = fixture('charger-state-offline');
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.equal(world.state(C, GO, 'connector'), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(world.state(C, GO, 'status'), 'Hors ligne');
  assert.equal(world.gladys.fake.transports.at(-1).transport, 'unreachable');
  assert.deepEqual(world.logger.at('info'), ['Garage: offline']);

  world.zaptec.states[GO] = fixture('charger-state-charging');
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.equal(world.gladys.fake.transports.at(-1).transport, 'cloud');
  assert.deepEqual(world.logger.at('info'), ['Garage: offline', 'Garage: back online']);
});

test('refused credentials stop every request until the configuration changes', async () => {
  const world = await createWorld({ config: { password: 'wrong' }, created: false });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.fr, /refusé/);
  const requests = world.zaptec.requests.length;
  for (let i = 0; i < 5; i += 1) {
    world.advance(2 * MINUTE);
    await world.app.cycle();
  }
  assert.equal(world.zaptec.requests.length, requests, 'no retry that could lock the account');
  assert.equal(world.logger.at('warn').length, 1);

  await world.gladys.fake.configUpdated({ ...ACCOUNT });
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
  assert.equal(world.gladys.fake.discoveredDevices.length, 3);
});

test('without an account, the configuration screen says what to fill in', async () => {
  const world = await createWorld({ config: { username: '', password: '' }, created: false });
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.en, /e-mail address/);
  assert.equal(world.zaptec.requests.length, 0);
});

test('a 429 pauses the readings for the delay Zaptec asks', async () => {
  const world = await createWorld();
  world.zaptec.fail.push({ path: /state$/, status: 429, headers: { 'retry-after': '200' } });
  world.advance(2 * MINUTE);
  await world.app.cycle();
  const after429 = world.zaptec.requests.length;
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.equal(world.zaptec.requests.length, after429, 'paused');
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.ok(world.zaptec.requests.length > after429, 'resumed after Retry-After');
  assert.equal(world.logger.at('warn').length, 1);
});

test('a meter index never goes back', async () => {
  const world = await createWorld();
  const ocmf = (rv) =>
    `OCMF|${JSON.stringify({ RD: [{ RV: rv, RU: 'kWh', RI: '1-0:1.8.0' }] })}|{"SD":"00"}`;
  world.zaptec.states[GO] = withObservations(world.zaptec.states[GO], {
    554: ocmf(12.5),
    723: undefined,
  });
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.equal(world.state(C, GO, 'total_energy'), 4821.337);
  world.zaptec.states[GO] = withObservations(world.zaptec.states[GO], { 554: ocmf(4822.1) });
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.equal(world.state(C, GO, 'total_energy'), 4822.1);
});

test('plugging a vehicle in and the end of a charge fire the scene triggers', async () => {
  const world = await createWorld();
  const id = world.gladys.externalIds(C, PRO).device;
  const readings = [
    'charger-state-requesting', // plugged in
    'charger-state-charging',
    'charger-state-completed', // ended by the vehicle
    'charger-state-disconnected',
    'charger-state-offline', // offline then back with a vehicle: no event
    'charger-state-charging',
    'charger-state-paused', // a pause is not an end of charge
  ];
  for (const name of readings) {
    world.zaptec.states[PRO] = fixture(name);
    world.advance(2 * MINUTE);
    await world.app.cycle();
  }
  assert.deepEqual(world.gladys.fake.sceneEvents, [
    {
      key: 'vehicle_connected',
      data: { charger: id, charger_name: 'Parking', session_energy: 0 },
    },
    {
      key: 'charging_completed',
      data: { charger: id, charger_name: 'Parking', session_energy: 38.552 },
    },
  ]);
  assert.ok(world.gladys.fake.widgetRefreshes.length > 0);
});

test('the charge switch pauses and resumes, and the effect is read back', async () => {
  const world = await createWorld();
  const device = world.device(C, GO);
  world.logger.clear();

  const ack = await world.gladys.fake.setValue(device, feature(world, C, GO, 'charge'), 0);
  assert.deepEqual(ack, { success: true });
  assert.equal(world.zaptec.paths('POST').at(-1), `/api/chargers/${GO}/sendCommand/506`);
  await world.runLaters();
  assert.equal(world.state(C, GO, 'charge'), 0);
  assert.equal(world.state(C, GO, 'charging_state'), CHARGING_STATE.PAUSED_BY_CHARGER);
  assert.equal(world.state(C, GO, 'status'), 'Charge en pause');

  await world.gladys.fake.setValue(device, feature(world, C, GO, 'charge'), 1);
  assert.equal(world.zaptec.paths('POST').at(-1), `/api/chargers/${GO}/sendCommand/507`);
  await world.runLaters();
  assert.equal(world.state(C, GO, 'charge'), 1);
  assert.deepEqual(world.logger.at('info'), [
    'Garage: stop_charging_final',
    'Garage: resume_charging',
  ]);
});

test('commands Zaptec would reject are refused here with a readable message', async () => {
  const world = await createWorld();
  const sent = () => world.zaptec.paths('POST').filter((p) => p.includes('/sendCommand/'));

  // No vehicle on the Pro.
  const noVehicle = await world.gladys.fake.setValue(
    world.device(C, PRO),
    feature(world, C, PRO, 'charge'),
    1,
  );
  assert.equal(noVehicle.success, false);
  assert.match(noVehicle.error, /No vehicle connected\. \/ Aucun véhicule branché\./);

  // Charging: nothing to resume. Ended by the vehicle: nothing to pause or resume.
  const resume = await world.gladys.fake.setValue(
    world.device(C, GO),
    feature(world, C, GO, 'charge'),
    1,
  );
  assert.match(resume.error, /Only a paused charge can resume/);
  world.zaptec.states[GO] = fixture('charger-state-completed');
  world.advance(2 * MINUTE);
  await world.app.cycle();
  const pause = await world.gladys.fake.setValue(
    world.device(C, GO),
    feature(world, C, GO, 'charge'),
    0,
  );
  assert.match(pause.error, /Not charging/);

  // Offline.
  world.zaptec.states[GO] = fixture('charger-state-offline');
  world.advance(2 * MINUTE);
  await world.app.cycle();
  const offline = await world.gladys.fake.sceneAction('charger_command', {
    device: world.gladys.externalIds(C, GO).device,
    command: 'stop',
  });
  assert.match(offline.error, /The charger is offline/);
  assert.deepEqual(sent(), []);
});

test('ending the session sends 10001, and Zaptec’s 500 answer is not an error', async () => {
  const world = await createWorld();
  const device = world.gladys.externalIds(C, GO).device;
  const ack = await world.gladys.fake.sceneAction('charger_command', { device, command: 'stop' });
  assert.deepEqual(ack, { success: true, data: { outputs: { command: 'deauthorize_and_stop' } } });
  assert.equal(world.zaptec.paths('POST').at(-1), `/api/chargers/${GO}/sendCommand/10001`);
  await world.runLaters();
  assert.equal(world.state(C, GO, 'status'), 'Véhicule branché, en attente');

  // Any other refusal says why.
  world.zaptec.fail.push({ path: /sendCommand/, status: 400 });
  const refused = await world.gladys.fake.sceneAction('charger_command', {
    device,
    command: 'stop',
  });
  assert.equal(refused.success, false);
  assert.match(refused.error, /Zaptec refused the command\..*\(HTTP 400\)/);

  const wrong = await world.gladys.fake.sceneAction('charger_command', {
    device: world.gladys.externalIds(I, INSTALLATION).device,
    command: 'pause',
  });
  assert.match(wrong.error, /Unknown charger/);
});

test('the available current of the installation is checked, sent and shown at once', async () => {
  const world = await createWorld();
  const device = world.device(I, INSTALLATION);
  const current = feature(world, I, INSTALLATION, 'available_current');
  for (const wrong of [-1, 41]) {
    const ack = await world.gladys.fake.setValue(device, current, wrong);
    assert.equal(ack.success, false, `${wrong} A refused (40 A installation)`);
  }
  assert.deepEqual(await world.gladys.fake.setValue(device, current, 16), { success: true });
  const updates = world.zaptec.requests.filter((r) => r.path.endsWith('/update'));
  assert.deepEqual(
    updates.map((r) => r.body),
    [{ availableCurrent: 16 }],
  );
  assert.equal(world.state(I, INSTALLATION, 'available_current'), 16);
  await world.runLaters();
  assert.equal(world.zaptec.installations[INSTALLATION].AvailableCurrent, 16);
  assert.deepEqual(await world.gladys.fake.setValue(device, current, 0), { success: true });

  // Rights withdrawn: the refusal names them.
  world.zaptec.fail.push({ path: /update$/, status: 403 });
  const forbidden = await world.gladys.fake.setValue(device, current, 10);
  assert.match(forbidden.error, /lacks the rights/);
});

test('a plain user sees the chargers but no installation device', async () => {
  const world = await createWorld({ created: false });
  delete world.zaptec.installations[INSTALLATION];
  await world.gladys.fake.configUpdated({ ...ACCOUNT, language: 'en' });
  assert.deepEqual(
    world.gladys.fake.discoveredDevices.map((d) => d.model),
    ['Zaptec Go', 'Zaptec Pro'],
  );
  assert.equal(world.gladys.fake.connectionStatus.connected, true);
});

test('the connection test lists what the account holds', async () => {
  const world = await createWorld();
  const ack = await world.gladys.fake.action('test_connection');
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.fr,
    'Connecté à Zaptec : 2 borne(s), 1 installation(s) avec réglage du courant.',
  );

  world.zaptec.fail.push({ network: true });
  const down = await world.gladys.fake.action('test_connection');
  assert.equal(down.success, false);
  assert.match(down.error, /Zaptec cloud unreachable\./);

  world.zaptec.password = 'changed in the Zaptec app';
  world.zaptec.validTokens.clear();
  const refused = await world.gladys.fake.action('test_connection');
  assert.equal(refused.success, false);
  assert.match(refused.error, /Zaptec refused the e-mail address/);
});

test('the widget shows a charger and its buttons, inside the core budget', async () => {
  const world = await createWorld();
  const device = world.gladys.externalIds(C, GO).device;
  const get = async (settings, language = 'fr') =>
    (await world.gladys.fake.widgetGet(WIDGET_KEY, { settings, language })).data.content;
  const buttons = (content) =>
    content.components.filter((c) => c.type === 'button').map((c) => c.action.key);

  const content = await get({ device });
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((i) => i.value),
    ['En charge', 'En ligne'],
  );
  assert.deepEqual(buttons(content), ['pause', 'stop']);
  // Every tile is bound to a feature the device really has.
  const ids = new Set(world.device(C, GO).features.map((f) => f.external_id));
  for (const tile of content.components.filter((c) => c.device_feature)) {
    assert.ok(ids.has(tile.device_feature), tile.device_feature);
  }

  const toast = await world.gladys.fake.widgetAction(
    WIDGET_KEY,
    'pause',
    {},
    { settings: { device } },
  );
  assert.equal(toast.success, true);
  assert.equal(toast.data.message.fr, 'Commande « Pause » envoyée à Garage.');
  await world.runLaters();
  assert.deepEqual(buttons(await get({ device })), ['resume', 'stop']);

  // Ended by the vehicle: only the end of the session. No vehicle: no button.
  world.zaptec.states[GO] = fixture('charger-state-completed');
  world.advance(2 * MINUTE);
  await world.app.cycle();
  assert.deepEqual(buttons(await get({ device })), ['stop']);
  const free = await get({ device: world.gladys.externalIds(C, PRO).device }, 'en');
  assert.deepEqual(validateWidgetContent(free), []);
  assert.deepEqual(buttons(free), []);

  // Not a charger, no device: a sentence.
  for (const settings of [{}, { device: world.gladys.externalIds(I, INSTALLATION).device }]) {
    const other = await get(settings, 'es');
    assert.deepEqual(validateWidgetContent(other), []);
    assert.equal(other.components[0].type, 'text');
  }
});

test('an expired token logs in again, and a restart reuses the saved one', async () => {
  const world = await createWorld();
  const logins = () => world.zaptec.paths().filter((p) => p === '/oauth/token').length;
  assert.equal(logins(), 1);
  world.advance(24 * 60 * MINUTE);
  await world.app.cycle();
  assert.equal(logins(), 2);
  assert.ok((await world.tokenStore.load()).accessToken.startsWith('token-'));
});
