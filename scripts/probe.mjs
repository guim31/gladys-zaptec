#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Zaptec cloud API, READ ONLY, printing nothing sensitive.
//
//   node scripts/probe.mjs
//       1. Reads the public constants (GET /api/constants, no login) and
//          checks the observation, operating mode and command numbers the
//          integration relies on (src/zaptec/model.js, src/zaptec/client.js).
//       2. Logs in with an invented account through the very client of the
//          integration and checks Zaptec refuses it the way the integration
//          expects (ZaptecError kind "auth").
//
//   ZAPTEC_USERNAME=... ZAPTEC_PASSWORD=... node scripts/probe.mjs
//       Same first step, then logs in with a real account and reads (GET
//       only) the chargers, the state of each charger and the installations.
//       It prints the SHAPE of each answer (field names and types) and a few
//       non-identifying values (operating mode, final stop, power, model
//       prefix, rights), to compare with test/fixtures/zaptec. Ids, serial
//       numbers, names, addresses, tokens and the password are never printed.
//       No command, no setting is ever sent.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import {
  COMMAND_IDS,
  ZAPTEC_API,
  ZaptecError,
  createZaptecClient,
  memoryTokenStore,
} from '../src/zaptec/client.js';
import { OBSERVATION, OP_MODE, modelName, observations } from '../src/zaptec/model.js';

const real = Boolean(process.env.ZAPTEC_USERNAME && process.env.ZAPTEC_PASSWORD);
const username = real
  ? process.env.ZAPTEC_USERNAME
  : `probe-${randomBytes(6).toString('hex')}@example.invalid`;
const password = real ? process.env.ZAPTEC_PASSWORD : randomBytes(12).toString('hex');

// Only the methods that read. The probe never holds a reference to the others.
const full = createZaptecClient({
  username,
  password,
  tokenStore: memoryTokenStore(),
  userAgent: 'gladys-zaptec-probe',
});
const client = {
  connect: full.connect,
  getChargers: full.getChargers,
  getChargerState: full.getChargerState,
  getInstallation: full.getInstallation,
};

/** Field names and types, values replaced by their type. */
function shape(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.length === 0 ? [] : [shape(value[0], depth + 1), `(${value.length} items)`];
  }
  if (value && typeof value === 'object') {
    if (depth > 3) {
      return 'object';
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, shape(v, depth + 1)]),
    );
  }
  return value === null ? 'null' : typeof value;
}

const print = (title, data) => console.log(`\n## ${title}\n${JSON.stringify(data, null, 2)}`);

async function step(title, fn) {
  try {
    return await fn();
  } catch (err) {
    const kind = err instanceof ZaptecError ? err.kind : 'unexpected';
    console.log(`\n## ${title}\nFAILED: ${kind} (${err.status ?? '-'}) ${err.message}`);
    process.exitCode = 1;
    return undefined;
  }
}

/** The numbers the code uses, checked against the public constants. */
async function checkConstants() {
  const response = await fetch(`${ZAPTEC_API}/api/constants`, {
    headers: { Accept: 'application/json', 'User-Agent': 'gladys-zaptec-probe' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new ZaptecError('server', `GET /api/constants failed (HTTP ${response.status})`, {
      status: response.status,
    });
  }
  const constants = await response.json();
  const observationIds = constants.ObservationIds ?? constants.Observations ?? {};
  const modes = constants.ChargerOperationModes ?? {};
  const commands = constants.CommandIds ?? constants.Commands ?? {};
  const expected = [
    ['observation IsOnline', observationIds.IsOnline, OBSERVATION.IS_ONLINE],
    ['observation CurrentPhase1', observationIds.CurrentPhase1, OBSERVATION.CURRENT_PHASE1],
    ['observation CurrentPhase2', observationIds.CurrentPhase2, OBSERVATION.CURRENT_PHASE2],
    ['observation CurrentPhase3', observationIds.CurrentPhase3, OBSERVATION.CURRENT_PHASE3],
    [
      'observation TotalChargePower',
      observationIds.TotalChargePower,
      OBSERVATION.TOTAL_CHARGE_POWER,
    ],
    [
      'observation TotalChargePowerSession',
      observationIds.TotalChargePowerSession,
      OBSERVATION.TOTAL_CHARGE_POWER_SESSION,
    ],
    [
      'observation SignedMeterValue',
      observationIds.SignedMeterValue,
      OBSERVATION.SIGNED_METER_VALUE,
    ],
    [
      'observation ChargerOperationMode',
      observationIds.ChargerOperationMode,
      OBSERVATION.CHARGER_OPERATION_MODE,
    ],
    ['observation FinalStopActive', observationIds.FinalStopActive, OBSERVATION.FINAL_STOP_ACTIVE],
    [
      'observation CompletedSession',
      observationIds.CompletedSession,
      OBSERVATION.COMPLETED_SESSION,
    ],
    ['mode Disconnected', modes.Disconnected, OP_MODE.DISCONNECTED],
    ['mode Connected_Requesting', modes.Connected_Requesting, OP_MODE.CONNECTED_REQUESTING],
    ['mode Connected_Charging', modes.Connected_Charging, OP_MODE.CONNECTED_CHARGING],
    ['mode Connected_Finished', modes.Connected_Finished, OP_MODE.CONNECTED_FINISHED],
    ['command StopChargingFinal', commands.StopChargingFinal, COMMAND_IDS.stop_charging_final],
    ['command ResumeCharging', commands.ResumeCharging, COMMAND_IDS.resume_charging],
    ['command DeauthorizeAndStop', commands.DeauthorizeAndStop, COMMAND_IDS.deauthorize_and_stop],
  ];
  print('GET /api/constants (top-level keys)', Object.keys(constants).sort());
  for (const [what, actual, wanted] of expected) {
    const ok = Number(actual) === wanted;
    console.log(`${ok ? 'OK  ' : 'DIFF'} ${what}: API ${actual ?? 'absent'}, code ${wanted}`);
    if (!ok) {
      process.exitCode = 1;
    }
  }
}

console.log(`Zaptec API probe (${real ? 'real account, read only' : 'invented account'})`);
await step('constants', checkConstants);

if (!real) {
  try {
    await client.connect();
    console.log('\nUNEXPECTED: Zaptec accepted an invented account.');
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof ZaptecError && err.kind === 'auth') {
      console.log(`\nOK: the login is refused as expected (HTTP ${err.status}, kind "auth").`);
    } else {
      console.log(
        `\nUNEXPECTED: ${err instanceof ZaptecError ? err.kind : err.name} (${err.status ?? '-'}) ${err.message}`,
      );
      process.exitCode = 1;
    }
  }
} else {
  await step('login', () => client.connect());
  const chargers = (await step('GET /api/chargers', () => client.getChargers())) ?? [];
  print('GET /api/chargers (shape of Data)', shape(chargers));
  print(
    'chargers (values)',
    chargers.map((c) => ({
      model: modelName(c.DeviceId),
      DeviceType: c.DeviceType,
      IsOnline: c.IsOnline,
      OperatingMode: c.OperatingMode,
      CurrentUserRoles: c.CurrentUserRoles,
      hasInstallation: Boolean(c.InstallationId),
    })),
  );
  for (const [index, charger] of chargers.entries()) {
    const state = await step(`state of charger #${index + 1}`, () =>
      client.getChargerState(charger.Id),
    );
    if (state) {
      const obs = observations(state);
      print(`GET /api/chargers/{#${index + 1}}/state (observation ids)`, [...obs.keys()].sort());
      print(`charger #${index + 1} (values)`, {
        IsOnline: obs.get(OBSERVATION.IS_ONLINE),
        ChargerOperationMode: obs.get(OBSERVATION.CHARGER_OPERATION_MODE),
        FinalStopActive: obs.get(OBSERVATION.FINAL_STOP_ACTIVE),
        TotalChargePower: obs.get(OBSERVATION.TOTAL_CHARGE_POWER),
        TotalChargePowerSession: obs.get(OBSERVATION.TOTAL_CHARGE_POWER_SESSION),
        SignedMeterValueStartsWithOcmf: String(
          obs.get(OBSERVATION.SIGNED_METER_VALUE) ?? '',
        ).startsWith('OCMF|'),
        CompletedSessionIsJson: String(obs.get(OBSERVATION.COMPLETED_SESSION) ?? '').startsWith(
          '{',
        ),
      });
    }
  }
  const installationIds = [...new Set(chargers.map((c) => c.InstallationId).filter(Boolean))];
  for (const [index, installationId] of installationIds.entries()) {
    const installation = await step(`installation #${index + 1}`, () =>
      client.getInstallation(installationId),
    );
    if (installation === null) {
      console.log(`\n## installation #${index + 1}\nno access (403 or 204): no current control`);
    } else if (installation) {
      print(`GET /api/installation/{#${index + 1}} (shape)`, shape(installation));
      print(`installation #${index + 1} (values)`, {
        MaxCurrent: installation.MaxCurrent,
        AvailableCurrent: installation.AvailableCurrent,
        AvailableCurrentPhase1: installation.AvailableCurrentPhase1,
        CurrentUserRoles: installation.CurrentUserRoles,
      });
    }
  }
}
