// -----------------------------------------------------------------------------
// The translation of Zaptec observations into Gladys values
// (src/zaptec/model.js), on the fixtures.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARGING_STATE,
  CONNECTOR_STATUS,
  OP_MODE,
  canPause,
  canResume,
  chargeOn,
  chargingState,
  connectorStatus,
  installationCurrents,
  isOnline,
  modelName,
  observations,
  ocmfMaxKwh,
  opModeOf,
  phaseCurrents,
  powerW,
  sessionEnergyKwh,
  statusKey,
  totalEnergyKwh,
  transitions,
} from '../src/zaptec/model.js';
import { fixture, withObservations } from './helpers/fakeZaptec.js';

const obsOf = (name) => observations(fixture(name));

test('a charging reading: power, currents, energies, states', () => {
  const obs = obsOf('charger-state-charging');
  assert.equal(opModeOf(obs), OP_MODE.CONNECTED_CHARGING);
  assert.equal(isOnline(obs), true);
  assert.equal(powerW(obs), 10912);
  assert.deepEqual(phaseCurrents(obs), [15.8, 15.9, 15.6]);
  assert.equal(sessionEnergyKwh(obs), 7.421);
  assert.equal(connectorStatus(obs, true), CONNECTOR_STATUS.OCCUPIED);
  assert.equal(chargingState(obs), CHARGING_STATE.CHARGING);
  assert.equal(statusKey(obs, true), 'charging');
  assert.equal(chargeOn(obs), 1);
  assert.equal(canPause(obs), true);
  assert.equal(canResume(obs), false);
});

test('the total energy is the highest signed reading, meter or last session', () => {
  // The signed meter value (4821.337) is newer than the end of the last session (4813.916).
  assert.equal(totalEnergyKwh(obsOf('charger-state-charging')), 4821.337);
  const onlySession = observations(
    withObservations(fixture('charger-state-charging'), { 554: undefined }),
  );
  assert.equal(totalEnergyKwh(onlySession), 4813.916);
  const none = observations(
    withObservations(fixture('charger-state-charging'), { 554: undefined, 723: undefined }),
  );
  assert.equal(totalEnergyKwh(none), null);
});

test('OCMF readings: the highest RV, in kWh, a damaged string gives null', () => {
  const ocmf = (rd) => `OCMF|${JSON.stringify({ FV: '1.0', RD: rd })}|{"SD":"00"}`;
  assert.equal(
    ocmfMaxKwh(
      ocmf([
        { RV: 10.5, RU: 'kWh' },
        { RV: 12.25, RU: 'kWh' },
      ]),
    ),
    12.25,
  );
  assert.equal(ocmfMaxKwh(ocmf([{ RV: 1500, RU: 'Wh' }])), 1.5);
  assert.equal(ocmfMaxKwh('OCMF|{broken'), null);
  assert.equal(ocmfMaxKwh('nothing'), null);
  assert.equal(ocmfMaxKwh(undefined), null);
});

test('paused by a command, ended by the vehicle, waiting, no vehicle, offline', () => {
  const paused = obsOf('charger-state-paused');
  assert.equal(chargingState(paused), CHARGING_STATE.PAUSED_BY_CHARGER);
  assert.equal(statusKey(paused, true), 'paused');
  assert.equal(canResume(paused), true);
  assert.equal(canPause(paused), false);
  assert.equal(chargeOn(paused), 0);

  const completed = obsOf('charger-state-completed');
  assert.equal(chargingState(completed), CHARGING_STATE.PAUSED_BY_VEHICLE);
  assert.equal(statusKey(completed, true), 'completed');
  assert.equal(canResume(completed), false, 'the vehicle ended it: nothing to resume');

  const requesting = obsOf('charger-state-requesting');
  assert.equal(chargingState(requesting), CHARGING_STATE.EV_CONNECTED);
  assert.equal(statusKey(requesting, true), 'requesting');
  assert.equal(connectorStatus(requesting, true), CONNECTOR_STATUS.OCCUPIED);

  const free = obsOf('charger-state-disconnected');
  assert.equal(connectorStatus(free, true), CONNECTOR_STATUS.AVAILABLE);
  assert.equal(chargingState(free), CHARGING_STATE.IDLE);
  assert.equal(statusKey(free, true), 'disconnected');

  const offline = obsOf('charger-state-offline');
  assert.equal(isOnline(offline), false);
  assert.equal(connectorStatus(offline, false), CONNECTOR_STATUS.UNAVAILABLE);
  assert.equal(statusKey(offline, false), 'offline');
});

test('online: the observation wins over the list, absent means the list, then online', () => {
  const without = observations(
    withObservations(fixture('charger-state-charging'), { '-2': undefined }),
  );
  assert.equal(isOnline(without, false), false);
  assert.equal(isOnline(without, true), true);
  assert.equal(isOnline(without), true);
  assert.equal(isOnline(observations([{ StateId: -2, ValueAsString: 'true' }]), false), true);
});

test('an empty or odd answer gives no value rather than a wrong one', () => {
  const empty = observations([]);
  assert.equal(opModeOf(empty), null);
  assert.equal(chargingState(empty), null);
  assert.equal(chargeOn(empty), null);
  assert.equal(powerW(empty), null);
  assert.equal(statusKey(empty, true), 'unknown');
  assert.equal(observations(null).size, 0);
  assert.equal(powerW(observations([{ StateId: 513, ValueAsString: '7,5' }])), 8);
  assert.equal(powerW(observations([{ StateId: 513, ValueAsString: 'n/a' }])), null);
});

test('the model follows the serial number prefix', () => {
  assert.equal(modelName('ZAP000101'), 'Zaptec Go');
  assert.equal(modelName('GPN000303'), 'Zaptec Go 2');
  assert.equal(modelName('ZPR000202'), 'Zaptec Pro');
  assert.equal(modelName('XYZ'), 'Zaptec');
  assert.equal(modelName(undefined), 'Zaptec');
});

test('installation currents: the global value, else the lowest phase', () => {
  assert.deepEqual(installationCurrents(fixture('installation')), { max: 40, available: 25 });
  assert.deepEqual(
    installationCurrents({
      MaxCurrent: 63,
      AvailableCurrentPhase1: 20,
      AvailableCurrentPhase2: 16,
      AvailableCurrentPhase3: 20,
    }),
    { max: 63, available: 16 },
  );
  assert.deepEqual(installationCurrents({}), { max: null, available: null });
});

test('scene transitions: plugged in, ended by the vehicle, never a pause or a return', () => {
  const { DISCONNECTED, CONNECTED_REQUESTING, CONNECTED_CHARGING, CONNECTED_FINISHED } = OP_MODE;
  assert.deepEqual(transitions(DISCONNECTED, CONNECTED_REQUESTING, false), ['vehicle_connected']);
  assert.deepEqual(transitions(DISCONNECTED, CONNECTED_CHARGING, false), ['vehicle_connected']);
  assert.deepEqual(transitions(CONNECTED_CHARGING, CONNECTED_FINISHED, false), [
    'charging_completed',
  ]);
  assert.deepEqual(transitions(CONNECTED_CHARGING, CONNECTED_FINISHED, true), [], 'a pause');
  assert.deepEqual(transitions(undefined, CONNECTED_CHARGING, false), [], 'first reading');
  assert.deepEqual(transitions(CONNECTED_CHARGING, CONNECTED_CHARGING, false), []);
  assert.deepEqual(transitions(CONNECTED_REQUESTING, CONNECTED_CHARGING, false), []);
});
