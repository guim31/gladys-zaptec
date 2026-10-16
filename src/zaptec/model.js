// -----------------------------------------------------------------------------
// Pure translation of what the Zaptec API answers into what Gladys shows.
//
// A charger state is a list of observations, `{ StateId, ValueAsString }`,
// numbered by Zaptec (GET /api/constants gives the names; the ones used here
// are listed in OBSERVATION). The operating mode (710) says whether a vehicle
// is there and whether it charges; FinalStopActive (718) tells a charge paused
// by a command from one the vehicle ended by itself.
//
// Gladys 5.2 has a generic charging-station vocabulary aligned on OCPP 2.0.1:
// a connector status (available, occupied, unavailable...) and, while a
// vehicle is there, a charging state (charging, vehicle connected, paused by
// the vehicle or by the charger, idle). The Zaptec modes follow it.
// -----------------------------------------------------------------------------

/** Observation ids of the Zaptec API (StateId), as /api/constants names them. */
export const OBSERVATION = {
  IS_ONLINE: -2,
  VOLTAGE_PHASE1: 501,
  CURRENT_PHASE1: 507,
  CURRENT_PHASE2: 508,
  CURRENT_PHASE3: 509,
  CHARGER_MAX_CURRENT: 510,
  TOTAL_CHARGE_POWER: 513, // W
  TOTAL_CHARGE_POWER_SESSION: 553, // kWh, the session in progress (or the last one)
  SIGNED_METER_VALUE: 554, // OCMF, holds the meter index in kWh
  CHARGER_OPERATION_MODE: 710,
  FINAL_STOP_ACTIVE: 718,
  COMPLETED_SESSION: 723, // JSON, with its own signed OCMF reading
};

/** ChargerOperationMode values (GET /api/constants, ChargerOperationModes). */
export const OP_MODE = {
  UNKNOWN: 0,
  DISCONNECTED: 1,
  CONNECTED_REQUESTING: 2,
  CONNECTED_CHARGING: 3,
  CONNECTED_FINISHED: 5,
};

/** CHARGING_STATION_CONNECTOR_STATUS of the Gladys core. */
export const CONNECTOR_STATUS = {
  AVAILABLE: 0,
  OCCUPIED: 1,
  RESERVED: 2,
  UNAVAILABLE: 3,
  FAULTED: 4,
};

/** CHARGING_STATION_CHARGING_STATE of the Gladys core. */
export const CHARGING_STATE = {
  CHARGING: 0,
  EV_CONNECTED: 1,
  PAUSED_BY_VEHICLE: 2,
  PAUSED_BY_CHARGER: 3,
  IDLE: 4,
  DISCHARGING: 5,
};

/** Modes in which a vehicle is plugged in. */
const VEHICLE_MODES = new Set([
  OP_MODE.CONNECTED_REQUESTING,
  OP_MODE.CONNECTED_CHARGING,
  OP_MODE.CONNECTED_FINISHED,
]);

/**
 * Charger models by the prefix of the serial number (DeviceId), as the
 * Zaptec documentation "Identify device types" lists them.
 */
const MODELS = [
  ['Zaptec Pro', ['ZCS', 'ZPR', 'ZCH', 'ZPG']],
  ['Zaptec Go', ['ZAP', 'ZGB', 'ZAG']],
  ['Zaptec Go 2', ['GPN', 'GPG']],
];

export function modelName(serial) {
  const prefix = String(serial ?? '')
    .slice(0, 3)
    .toUpperCase();
  return MODELS.find(([, prefixes]) => prefixes.includes(prefix))?.[0] ?? 'Zaptec';
}

const finite = (value) => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = typeof value === 'string' ? Number(value.replace(',', '.')) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const TRUTHY = new Set(['1', 'true', 'on', 'yes']);

/**
 * The observations of a state as a Map of StateId -> value (a string, or the
 * raw value when Zaptec gives one). A later duplicate wins.
 * @param {Array<{ StateId: number|string, ValueAsString?: string, Value?: unknown }>} state
 */
export function observations(state) {
  const map = new Map();
  for (const item of Array.isArray(state) ? state : []) {
    const id = Number(item?.StateId);
    if (!Number.isFinite(id)) {
      continue;
    }
    const value = item.Value ?? item.ValueAsString;
    if (value !== undefined) {
      map.set(id, value);
    }
  }
  return map;
}

/** The operating mode, or null when absent. */
export function opModeOf(obs) {
  const mode = finite(obs.get(OBSERVATION.CHARGER_OPERATION_MODE));
  return mode === null ? null : Math.trunc(mode);
}

function flag(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) {
    return null;
  }
  return TRUTHY.has(String(value).trim().toLowerCase());
}

/** A pause by command is in force (StopChargingFinal sent, not resumed). */
export function finalStopActive(obs) {
  return flag(obs.get(OBSERVATION.FINAL_STOP_ACTIVE)) === true;
}

/**
 * The charger reaches the cloud. The IsOnline observation wins; without it,
 * the flag of the charger list; without both, online.
 * @param {Map<number, unknown>} obs
 * @param {boolean} [listed] IsOnline of GET /api/chargers
 */
export function isOnline(obs, listed) {
  const observed = flag(obs.get(OBSERVATION.IS_ONLINE));
  if (observed !== null) {
    return observed;
  }
  return listed !== false;
}

export function hasVehicle(mode) {
  return VEHICLE_MODES.has(mode);
}

/** @returns {number|null} a CONNECTOR_STATUS value */
export function connectorStatus(obs, online) {
  if (!online) {
    return CONNECTOR_STATUS.UNAVAILABLE;
  }
  const mode = opModeOf(obs);
  if (mode === OP_MODE.DISCONNECTED) {
    return CONNECTOR_STATUS.AVAILABLE;
  }
  return VEHICLE_MODES.has(mode) ? CONNECTOR_STATUS.OCCUPIED : null;
}

/**
 * The charging state. The core only gives it a meaning during a session; the
 * rest of the time it is published as idle, so a charge interrupted by an
 * unplugged cable does not stay "charging" on the dashboard.
 * @returns {number|null} a CHARGING_STATE value
 */
export function chargingState(obs) {
  const mode = opModeOf(obs);
  const paused = finalStopActive(obs);
  switch (mode) {
    case OP_MODE.CONNECTED_CHARGING:
      return CHARGING_STATE.CHARGING;
    case OP_MODE.CONNECTED_REQUESTING:
      return paused ? CHARGING_STATE.PAUSED_BY_CHARGER : CHARGING_STATE.EV_CONNECTED;
    case OP_MODE.CONNECTED_FINISHED:
      return paused ? CHARGING_STATE.PAUSED_BY_CHARGER : CHARGING_STATE.PAUSED_BY_VEHICLE;
    case null:
      return null;
    default:
      return CHARGING_STATE.IDLE;
  }
}

/** Key of the status text: one of STATUS in src/i18n.js. */
export function statusKey(obs, online) {
  if (!online) {
    return 'offline';
  }
  const mode = opModeOf(obs);
  switch (mode) {
    case OP_MODE.DISCONNECTED:
      return 'disconnected';
    case OP_MODE.CONNECTED_REQUESTING:
      return finalStopActive(obs) ? 'paused' : 'requesting';
    case OP_MODE.CONNECTED_CHARGING:
      return 'charging';
    case OP_MODE.CONNECTED_FINISHED:
      return finalStopActive(obs) ? 'paused' : 'completed';
    default:
      return 'unknown';
  }
}

/** 1 while the charger delivers current (the "charge" switch). */
export function chargeOn(obs) {
  const mode = opModeOf(obs);
  if (mode === null) {
    return null;
  }
  return mode === OP_MODE.CONNECTED_CHARGING ? 1 : 0;
}

/** Total charging power, in watts. */
export function powerW(obs) {
  const watts = finite(obs.get(OBSERVATION.TOTAL_CHARGE_POWER));
  return watts === null ? null : Math.max(0, Math.round(watts));
}

/** Energy of the session in progress (or of the last one), in kWh. */
export function sessionEnergyKwh(obs) {
  const kwh = finite(obs.get(OBSERVATION.TOTAL_CHARGE_POWER_SESSION));
  return kwh === null ? null : Math.max(0, round(kwh, 3));
}

/** Current per phase, in amperes. */
export function phaseCurrents(obs) {
  return [OBSERVATION.CURRENT_PHASE1, OBSERVATION.CURRENT_PHASE2, OBSERVATION.CURRENT_PHASE3].map(
    (id) => {
      const amps = finite(obs.get(id));
      return amps === null ? null : Math.max(0, round(amps, 1));
    },
  );
}

/**
 * The highest meter reading (kWh) of an OCMF string ("OCMF|{json}|{signature}"),
 * or null. OCMF is the signed format of the German calibration law (Eichrecht):
 * its readings (`RD`) carry the meter index in `RV`, in the unit `RU`.
 */
export function ocmfMaxKwh(text) {
  if (typeof text !== 'string' || !text.startsWith('OCMF|')) {
    return null;
  }
  const sections = text.split('|');
  let data;
  try {
    data = JSON.parse(sections[1]);
  } catch {
    return null;
  }
  const readings = Array.isArray(data?.RD) ? data.RD : [];
  let max = null;
  for (const reading of readings) {
    let value = finite(reading?.RV);
    if (value === null || value < 0) {
      continue;
    }
    if (String(reading.RU ?? 'kWh').toLowerCase() === 'wh') {
      value /= 1000;
    }
    max = max === null ? value : Math.max(max, value);
  }
  return max;
}

/**
 * The meter index of the charger since its installation, in kWh: the highest
 * of the signed meter value (sent by the charger about once an hour) and of
 * the signed reading at the end of the last session.
 */
export function totalEnergyKwh(obs) {
  const candidates = [ocmfMaxKwh(obs.get(OBSERVATION.SIGNED_METER_VALUE))];
  const completed = obs.get(OBSERVATION.COMPLETED_SESSION);
  if (typeof completed === 'string' && completed.trim().startsWith('{')) {
    try {
      candidates.push(ocmfMaxKwh(JSON.parse(completed).SignedSession));
    } catch {
      // A damaged session record: the signed meter value alone.
    }
  }
  const values = candidates.filter((v) => v !== null);
  return values.length === 0 ? null : round(Math.max(...values), 3);
}

/** Zaptec only pauses a charge that is charging (command 506). */
export function canPause(obs) {
  return opModeOf(obs) === OP_MODE.CONNECTED_CHARGING;
}

/**
 * Zaptec only resumes a charge paused by a command (507): finished with a
 * final stop in force. A charge the vehicle ended (full battery, its own
 * schedule) cannot be resumed from the charger.
 */
export function canResume(obs) {
  return opModeOf(obs) === OP_MODE.CONNECTED_FINISHED && finalStopActive(obs);
}

/**
 * What the installation answers (GET /api/installation/{id}): its fuse
 * (MaxCurrent) and the current it currently lets the chargers draw, in
 * amperes. Per-phase limits that differ give the lowest one.
 */
export function installationCurrents(installation) {
  const max = finite(installation?.MaxCurrent);
  let available = finite(installation?.AvailableCurrent);
  if (available === null) {
    const phases = ['AvailableCurrentPhase1', 'AvailableCurrentPhase2', 'AvailableCurrentPhase3']
      .map((key) => finite(installation?.[key]))
      .filter((v) => v !== null);
    available = phases.length > 0 ? Math.min(...phases) : null;
  }
  return {
    max: max === null || max <= 0 ? null : Math.round(max),
    available: available === null ? null : Math.max(0, round(available, 1)),
  };
}

/**
 * The scene events a change of operating mode means, or [].
 *   - vehicle_connected: from "no vehicle" to any mode with a vehicle (never
 *     from an unknown or offline reading: a charger coming back with a
 *     vehicle already there is not a vehicle being plugged in);
 *   - charging_completed: from charging to finished WITHOUT a final stop (the
 *     vehicle stopped taking current by itself — a full battery or its own
 *     limit), not a pause sent from Gladys or the app.
 * @param {number|null|undefined} previous mode of the previous online reading
 * @param {number|null} current
 * @param {boolean} paused FinalStopActive of the current reading
 * @returns {string[]}
 */
export function transitions(previous, current, paused) {
  if (previous === null || previous === undefined || current === null || previous === current) {
    return [];
  }
  const events = [];
  if (previous === OP_MODE.DISCONNECTED && VEHICLE_MODES.has(current)) {
    events.push('vehicle_connected');
  }
  if (
    previous === OP_MODE.CONNECTED_CHARGING &&
    current === OP_MODE.CONNECTED_FINISHED &&
    !paused
  ) {
    events.push('charging_completed');
  }
  return events;
}
