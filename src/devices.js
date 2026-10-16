// -----------------------------------------------------------------------------
// The Gladys devices: one per Zaptec charger, one per installation whose
// current the account may read (owner or service rights).
//
// External ids are built from the id Zaptec gives each charger and
// installation (a UUID that never changes, whatever the name). Feature keys
// are frozen too. Feature names are frozen when the user adds the device, in
// the language of the configuration.
//
// Polling fields: `should_poll: true` with the one-minute frequency of the
// core list, so a core that polls calls onPoll (fallback); the container's own
// timer does the real work (src/app.js, Gladys#3198).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { NAMES, STATUS, pick } from './i18n.js';
import {
  chargeOn,
  chargingState,
  connectorStatus,
  installationCurrents,
  modelName,
  phaseCurrents,
  powerW,
  sessionEnergyKwh,
  statusKey,
  totalEnergyKwh,
} from './zaptec/model.js';

export const DEVICE_TYPE = { CHARGER: 'charger', INSTALLATION: 'installation' };

/** Feature keys of a charger (frozen: they are part of the external ids). */
export const CHARGER_FEATURE = {
  CONNECTOR: 'connector',
  CHARGING_STATE: 'charging_state',
  STATUS: 'status',
  POWER: 'power',
  CURRENT_L1: 'current_l1',
  CURRENT_L2: 'current_l2',
  CURRENT_L3: 'current_l3',
  SESSION_ENERGY: 'session_energy',
  TOTAL_ENERGY: 'total_energy',
  CHARGE: 'charge',
};

/** Feature keys of an installation. */
export const INSTALLATION_FEATURE = {
  AVAILABLE_CURRENT: 'available_current',
  MAX_CURRENT: 'max_current',
};

const POLLING = { should_poll: true, poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES };

// Display bounds: the core never applies min/max on a state, they only scale
// the charts and gauges. A Zaptec Pro delivers up to 22 kW on 32 A.
const MAX_POWER_W = 25000;
const MAX_CURRENT_A = 40;
const MAX_INDEX_KWH = 100000000;
/** Installation fuse when Zaptec does not give it. */
const DEFAULT_INSTALLATION_MAX_A = 32;

function feature(ids, names, key, spec) {
  return {
    name: names[key],
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...spec,
  };
}

/**
 * @param {object} gladys GladysIntegration (externalIds)
 * @param {{ Id: string, Name?: string, DeviceId?: string }} charger as GET /api/chargers lists it
 * @param {{ language: string }} options
 */
export function buildChargerDevice(gladys, charger, { language }) {
  const ids = gladys.externalIds(DEVICE_TYPE.CHARGER, charger.Id);
  const names = NAMES[language] ?? NAMES.en;
  const f = (key, spec) => feature(ids, names, key, spec);
  const current = (key) =>
    f(key, {
      category: CAT.ENERGY_SENSOR,
      type: TYPE.ENERGY_SENSOR.CURRENT,
      unit: UNIT.AMPERE,
      min: 0,
      max: MAX_CURRENT_A,
    });
  return {
    name: charger.Name?.trim() || charger.DeviceId || charger.Id,
    external_id: ids.device,
    model: modelName(charger.DeviceId),
    ...POLLING,
    params: [{ name: 'ZAPTEC_SERIAL', value: String(charger.DeviceId ?? '') }],
    features: [
      f(CHARGER_FEATURE.CONNECTOR, {
        category: CAT.CHARGING_STATION,
        type: TYPE.CHARGING_STATION.CONNECTOR_STATUS,
        min: 0,
        max: 4,
      }),
      f(CHARGER_FEATURE.CHARGING_STATE, {
        category: CAT.CHARGING_STATION,
        type: TYPE.CHARGING_STATION.CHARGING_STATE,
        min: 0,
        max: 5,
      }),
      // text/text: min/max are NOT NULL in the core table, 0/0 like Zigbee2MQTT.
      f(CHARGER_FEATURE.STATUS, {
        category: CAT.TEXT,
        type: TYPE.TEXT.TEXT,
        min: 0,
        max: 0,
        keep_history: false,
      }),
      f(CHARGER_FEATURE.POWER, {
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.POWER,
        unit: UNIT.WATT,
        min: 0,
        max: MAX_POWER_W,
      }),
      current(CHARGER_FEATURE.CURRENT_L1),
      current(CHARGER_FEATURE.CURRENT_L2),
      current(CHARGER_FEATURE.CURRENT_L3),
      // Not energy-sensor/energy: the core reads that type as a meter index
      // for the energy monitoring, and a session restarts from zero.
      f(CHARGER_FEATURE.SESSION_ENERGY, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.LAST_CHARGE_ENERGY_ADDED,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: 200,
      }),
      // The meter index of the 5.2 energy monitoring (consumption every 30 min).
      f(CHARGER_FEATURE.TOTAL_ENERGY, {
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.INDEX,
        unit: UNIT.KILOWATT_HOUR,
        min: 0,
        max: MAX_INDEX_KWH,
      }),
      // On: resume a charge paused by a command; off: pause (Zaptec 507 / 506).
      f(CHARGER_FEATURE.CHARGE, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      }),
    ],
  };
}

/**
 * @param {object} gladys
 * @param {{ Id: string, Name?: string, MaxCurrent?: number }} installation GET /api/installation/{id}
 * @param {{ language: string }} options
 */
export function buildInstallationDevice(gladys, installation, { language }) {
  const ids = gladys.externalIds(DEVICE_TYPE.INSTALLATION, installation.Id);
  const names = NAMES[language] ?? NAMES.en;
  const f = (key, spec) => feature(ids, names, key, spec);
  const max = installationCurrents(installation).max ?? DEFAULT_INSTALLATION_MAX_A;
  return {
    name: installation.Name?.trim() || `Zaptec ${String(installation.Id).slice(0, 8)}`,
    external_id: ids.device,
    model: 'Zaptec installation',
    ...POLLING,
    features: [
      // What the chargers of the installation may draw together, all phases.
      f(INSTALLATION_FEATURE.AVAILABLE_CURRENT, {
        category: CAT.ELECTRICAL_VEHICLE_CHARGE,
        type: TYPE.ELECTRICAL_VEHICLE_CHARGE.TARGET_CURRENT,
        unit: UNIT.AMPERE,
        min: 0,
        max,
        step: 1,
        read_only: false,
        has_feedback: true,
      }),
      f(INSTALLATION_FEATURE.MAX_CURRENT, {
        category: CAT.ENERGY_SENSOR,
        type: TYPE.ENERGY_SENSOR.CURRENT,
        unit: UNIT.AMPERE,
        min: 0,
        max,
        keep_history: false,
      }),
    ],
  };
}

const numeric = (id, value) =>
  value === null || value === undefined ? null : { device_feature_external_id: id, state: value };

/**
 * The states of a charger reading, in the publishStates format.
 * @param {{ feature: (key: string) => string }} ids
 * @param {Map<number, unknown>} obs observations (src/zaptec/model.js)
 * @param {boolean} online
 * @param {string} language
 */
export function chargerStates(ids, obs, online, language) {
  const [l1, l2, l3] = phaseCurrents(obs);
  const F = CHARGER_FEATURE;
  return [
    numeric(ids.feature(F.CONNECTOR), connectorStatus(obs, online)),
    numeric(ids.feature(F.CHARGING_STATE), chargingState(obs)),
    {
      device_feature_external_id: ids.feature(F.STATUS),
      text: pick(STATUS[statusKey(obs, online)], language),
    },
    numeric(ids.feature(F.POWER), powerW(obs)),
    numeric(ids.feature(F.CURRENT_L1), l1),
    numeric(ids.feature(F.CURRENT_L2), l2),
    numeric(ids.feature(F.CURRENT_L3), l3),
    numeric(ids.feature(F.SESSION_ENERGY), sessionEnergyKwh(obs)),
    numeric(ids.feature(F.TOTAL_ENERGY), totalEnergyKwh(obs)),
    numeric(ids.feature(F.CHARGE), chargeOn(obs)),
  ].filter(Boolean);
}

/** The states of an installation reading. */
export function installationStates(ids, installation) {
  const { available, max } = installationCurrents(installation);
  return [
    numeric(ids.feature(INSTALLATION_FEATURE.AVAILABLE_CURRENT), available),
    numeric(ids.feature(INSTALLATION_FEATURE.MAX_CURRENT), max),
  ].filter(Boolean);
}

/**
 * Which device an external id names: { type, id } or null.
 * @param {object} gladys
 * @param {string} externalId a device or feature external id
 */
export function parseExternalId(gladys, externalId) {
  const prefix = gladys.externalId('');
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const [type, id] = externalId.slice(prefix.length).split(':');
  if (!Object.values(DEVICE_TYPE).includes(type) || !id) {
    return null;
  }
  return { type, id };
}
