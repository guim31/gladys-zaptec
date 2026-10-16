// -----------------------------------------------------------------------------
// The integration: the Zaptec account, its devices, the refresh timer, the
// commands, the scene triggers and action, the widget.
//
// Everything Gladys calls is registered here on the Gladys client it is given
// (the real one in index.js, the SDK's fake Gladys in the tests), so the tests
// run the very code the container runs.
//
// Refresh: the core cannot be trusted to poll an external device
// (Gladys#3198, still there in 5.2.1), so the container reads the Zaptec
// cloud itself, every `poll_interval` seconds (1 to 5 minutes), for the
// devices the user added. The core's onPoll is a fallback that does nothing
// while the timer keeps up. Zaptec asks for a fair use of its API: one
// reading of the state per charger and per period, the installation every
// ten minutes, and a 429 pauses everything for the delay Zaptec asks
// (5 minutes when it does not say).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig, pollPeriodMs } from './config.js';
import { createZaptecClient, ZaptecError } from './zaptec/client.js';
import {
  OP_MODE,
  canPause,
  canResume,
  finalStopActive,
  hasVehicle,
  installationCurrents,
  isOnline,
  observations,
  opModeOf,
  sessionEnergyKwh,
  statusKey,
  transitions,
} from './zaptec/model.js';
import {
  CHARGER_FEATURE,
  DEVICE_TYPE,
  INSTALLATION_FEATURE,
  buildChargerDevice,
  buildInstallationDevice,
  chargerStates,
  installationStates,
  parseExternalId,
} from './devices.js';
import { MESSAGES, STATUS, TEXT, pick, thrown } from './i18n.js';
import { createIssueLog } from './issues.js';

export const WIDGET_KEY = 'charger';
export const SCENE_TRIGGERS = ['vehicle_connected', 'charging_completed'];
export const SCENE_ACTION_KEY = 'charger_command';
/** Scene action and widget commands, and the Zaptec command each one sends. */
export const CHARGER_COMMANDS = {
  pause: 'stop_charging_final',
  resume: 'resume_charging',
  stop: 'deauthorize_and_stop',
};

/** Re-send an unchanged value this often, so Gladys never sees it as stale. */
export const HEARTBEAT_MS = 6 * 60 * 60 * 1000;
/** The installation limits change rarely: read every ten minutes. */
export const INSTALLATION_PERIOD_MS = 10 * 60 * 1000;
/** Pause after a 429 that does not say how long. */
const RATE_LIMIT_PAUSE_MS = 5 * 60 * 1000;
/** Read a device again this long after a command, to show its effect. */
const COMMAND_REFRESH_MS = 10 * 1000;

/**
 * @param {object} options
 * @param {object} options.gladys GladysIntegration or the SDK's fake Gladys
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} options.logger
 * @param {(config: object) => ReturnType<typeof createZaptecClient>} [options.createClient]
 * @param {boolean} [options.timers] run the refresh timer (the tests drive the cycles)
 * @param {(fn: Function, ms: number) => void} [options.later] delayed refresh after a command
 * @param {() => number} [options.now]
 */
export function createApp({
  gladys,
  logger,
  createClient = (config) =>
    createZaptecClient({ username: config.username, password: config.password }),
  timers = true,
  later = (fn, ms) => setTimeout(fn, ms).unref?.(),
  now = () => Date.now(),
}) {
  const issues = createIssueLog(logger);
  let config = normalizeConfig();
  let client = null;
  /** Zaptec refused the credentials: nothing is retried until the config changes. */
  let authRefused = false;
  /** What the account holds, known once discovered. */
  let products = null;
  let pausedUntil = 0;
  /** The last error of the account as a whole, for the connection test. */
  let lastAccountError = null;
  let timer = null;
  let stopped = true;
  let cloudOk = null;
  const readings = new Map(); // charger id -> { obs, online, at }
  const lastMode = new Map(); // charger id -> mode of the last online reading
  const highestIndex = new Map(); // feature external id -> kWh (meters never go back)
  const transport = new Map(); // device external id -> published transport
  const lastPolledAt = new Map(); // device external id -> ms
  const inFlight = new Map();

  // --- Account ---------------------------------------------------------------

  function credentialsOf(cfg) {
    return `${cfg.username}\n${cfg.password}`;
  }

  async function setup() {
    products = null;
    if (!isConfigured(config)) {
      client = null;
      logger.info('Not configured yet: waiting for the Zaptec account');
      await gladys.setConnectionStatus(false, TEXT.notConfigured);
      return false;
    }
    if (authRefused) {
      await gladys.setConnectionStatus(false, TEXT.authRefused);
      return false;
    }
    client ??= createClient(config);
    try {
      await discover();
    } catch (err) {
      await reportAccountError(err);
      return false;
    }
    return true;
  }

  async function discover() {
    await client.connect();
    const chargers = (await client.getChargers()).filter((c) => c && c.Id);
    const installations = new Map();
    for (const installationId of new Set(chargers.map((c) => c.InstallationId).filter(Boolean))) {
      try {
        const installation = await client.getInstallation(installationId);
        if (installation?.Id) {
          installations.set(String(installation.Id), installation);
        } else {
          logger.debug(`Installation ${installationId}: no access, no current control`);
        }
      } catch (err) {
        if (err instanceof ZaptecError && ['auth', 'rate_limit'].includes(err.kind)) {
          throw err;
        }
        // The installation only brings the current control: the chargers go on.
        logger.debug(`Reading installation ${installationId} failed (${err.message})`);
      }
    }
    products = {
      chargers: new Map(chargers.map((c) => [String(c.Id), c])),
      installations,
    };
    await gladys.publishDiscoveredDevices(buildDevices());
    if (cloudOk !== true) {
      logger.info(
        `Connected to Zaptec: ${chargers.length} charger(s), ${installations.size} installation(s) with current control`,
      );
    }
    cloudOk = true;
    await gladys.setConnectionStatus(true);
  }

  function buildDevices() {
    if (!products) {
      return [];
    }
    return [
      ...[...products.chargers.values()].map((charger) =>
        buildChargerDevice(gladys, charger, { language: config.language }),
      ),
      ...[...products.installations.values()].map((installation) =>
        buildInstallationDevice(gladys, installation, { language: config.language }),
      ),
    ];
  }

  /** An error of the account as a whole (login, cloud down, rate limit). */
  async function reportAccountError(err) {
    lastAccountError = err;
    if (err instanceof ZaptecError && err.kind === 'auth') {
      if (!authRefused) {
        logger.warn('Zaptec refused the credentials: fix them in the configuration');
      }
      authRefused = true;
      cloudOk = false;
      await gladys.setConnectionStatus(false, TEXT.authRefused);
      return;
    }
    if (err instanceof ZaptecError && err.kind === 'rate_limit') {
      pausedUntil = now() + (err.retryAfterMs ?? RATE_LIMIT_PAUSE_MS);
      issues.fail('rate_limit', `Zaptec rate limit reached: paused until ${iso(pausedUntil)}`);
      return;
    }
    issues.fail('cloud', `Zaptec cloud unreachable (${err.message})`);
    if (cloudOk !== false) {
      cloudOk = false;
      await gladys.setConnectionStatus(false, MESSAGES.unreachable(err.message));
    }
  }

  async function cloudWorks() {
    issues.ok('cloud', 'Zaptec cloud reachable again');
    issues.ok('rate_limit', 'Zaptec rate limit over');
    if (cloudOk === false) {
      cloudOk = true;
      await gladys.setConnectionStatus(true);
    }
  }

  // --- Readings --------------------------------------------------------------

  /** The devices the user added to Gladys, with what they are on Zaptec. */
  function createdDevices() {
    return (gladys.devices ?? [])
      .map((device) => ({ device, ref: parseExternalId(gladys, device.external_id) }))
      .filter(({ ref }) => ref);
  }

  /** Meter indexes never go back: a lower reading of the cloud is dropped. */
  function monotonic(states) {
    return states.filter((s) => {
      if (!s.device_feature_external_id.endsWith(`:${CHARGER_FEATURE.TOTAL_ENERGY}`)) {
        return true;
      }
      const highest = highestIndex.get(s.device_feature_external_id);
      if (highest !== undefined && s.state < highest) {
        logger.debug(`${s.device_feature_external_id}: ${s.state} < ${highest}, dropped`);
        return false;
      }
      highestIndex.set(s.device_feature_external_id, s.state);
      return true;
    });
  }

  async function publishTransport(externalId, online) {
    const value = online ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.UNREACHABLE;
    if (transport.get(externalId) === value) {
      return;
    }
    transport.set(externalId, value);
    await gladys.publishTransports([{ external_id: externalId, transport: value }]);
  }

  async function readCharger(id) {
    const ids = gladys.externalIds(DEVICE_TYPE.CHARGER, id);
    const obs = observations(await client.getChargerState(id));
    const previous = readings.get(id);
    const online = isOnline(obs, products?.chargers.get(id)?.IsOnline);
    readings.set(id, { obs, online, at: now() });

    await gladys.publishChangedStates(monotonic(chargerStates(ids, obs, online, config.language)), {
      heartbeat: HEARTBEAT_MS,
    });

    if (transport.has(ids.device) && (transport.get(ids.device) === 'cloud') !== online) {
      logger.info(`${chargerName(id)}: ${online ? 'back online' : 'offline'}`);
    }
    await publishTransport(ids.device, online);

    const mode = opModeOf(obs);
    let events = [];
    if (!online || mode === null || mode === OP_MODE.UNKNOWN) {
      // Nothing to compare with when the charger comes back.
      lastMode.delete(id);
    } else {
      events = transitions(lastMode.get(id), mode, finalStopActive(obs));
      lastMode.set(id, mode);
    }
    for (const key of events) {
      logger.debug(`${id}: scene event ${key}`);
      await gladys
        .publishSceneEvent(key, {
          charger: ids.device,
          charger_name: chargerName(id),
          session_energy: sessionEnergyKwh(obs) ?? 0,
        })
        .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
    }
    const statusBefore = previous ? statusKey(previous.obs, previous.online) : null;
    if (events.length > 0 || statusBefore !== statusKey(obs, online)) {
      gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async function readInstallation(id) {
    const ids = gladys.externalIds(DEVICE_TYPE.INSTALLATION, id);
    const installation = await client.getInstallation(id);
    if (!installation) {
      // The rights were withdrawn since the discovery.
      throw new ZaptecError('forbidden', `Installation ${id}: no access any more`, {
        status: 403,
      });
    }
    products?.installations.set(id, installation);
    await gladys.publishChangedStates(installationStates(ids, installation), {
      heartbeat: HEARTBEAT_MS,
    });
    await publishTransport(ids.device, true);
  }

  function chargerName(id) {
    return products?.chargers.get(id)?.Name || id;
  }

  /** Read every period, the installation every ten minutes at most. */
  function periodOf(ref) {
    return ref.type === DEVICE_TYPE.INSTALLATION
      ? Math.max(INSTALLATION_PERIOD_MS, pollPeriodMs(config))
      : pollPeriodMs(config);
  }

  /**
   * Read one device, unless it was read less than its period ago (less a
   * tolerance of `1 - minGap` refresh periods).
   * Errors are logged once while they last; the account-wide ones (refused
   * credentials, rate limit, network) stop the cycle.
   */
  async function pollDevice(device, ref, { force = false, minGap = 0.5 } = {}) {
    const key = device.external_id;
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }
    const last = lastPolledAt.get(key);
    // The timer drifts: a device due within (1 - minGap) of a period is read now.
    const gap = periodOf(ref) - pollPeriodMs(config) * (1 - minGap);
    if (!force && last !== undefined && now() - last < gap) {
      logger.debug(`${key}: read ${now() - last} ms ago, skipped`);
      return undefined;
    }
    lastPolledAt.set(key, now());
    const run = (async () => {
      try {
        if (ref.type === DEVICE_TYPE.CHARGER) {
          await readCharger(ref.id);
        } else {
          await readInstallation(ref.id);
        }
        issues.ok(key, `${ref.type} ${ref.id}: readings work again`);
        await cloudWorks();
      } catch (err) {
        if (err instanceof ZaptecError && ['auth', 'rate_limit', 'network'].includes(err.kind)) {
          await reportAccountError(err);
          throw err;
        }
        issues.fail(key, `${ref.type} ${ref.id}: reading failed (${err.message})`);
        await publishTransport(key, false).catch(() => {});
      }
    })();
    inFlight.set(key, run);
    try {
      return await run;
    } finally {
      inFlight.delete(key);
    }
  }

  /** Can the cloud be read now? Sets the account up again when needed. */
  async function ready() {
    if (gladys.connected === false || authRefused || !isConfigured(config)) {
      return false;
    }
    if (now() < pausedUntil) {
      logger.debug(`Rate limited: no reading before ${iso(pausedUntil)}`);
      return false;
    }
    if (!products) {
      return setup();
    }
    return true;
  }

  /** One refresh of every added device. Never throws. */
  async function cycle({ force = false } = {}) {
    try {
      if (!(await ready())) {
        return;
      }
      for (const { device, ref } of createdDevices()) {
        try {
          await pollDevice(device, ref, { force });
        } catch {
          // Account-wide error, already reported: the next devices would fail too.
          return;
        }
      }
    } catch (err) {
      logger.error(`Refresh cycle failed (${err.message})`);
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      await cycle();
      schedule();
    }, pollPeriodMs(config));
    timer.unref?.();
  }

  // --- Commands ----------------------------------------------------------------

  function translateError(err) {
    if (!(err instanceof ZaptecError)) {
      return err;
    }
    const text = {
      auth: TEXT.authRefused,
      rate_limit: TEXT.rateLimited,
      forbidden: TEXT.forbidden,
      network: TEXT.cloudUnreachable,
      server: TEXT.cloudUnreachable,
    }[err.kind];
    return new Error(text ? thrown(text) : `${thrown(TEXT.commandRefused)} (HTTP ${err.status})`);
  }

  function refOf(externalId, type, unknown) {
    const ref = parseExternalId(gladys, externalId);
    if (!ref || ref.type !== type) {
      throw new Error(thrown(unknown));
    }
    return ref.id;
  }

  const chargerIdOf = (externalId) => refOf(externalId, DEVICE_TYPE.CHARGER, TEXT.unknownCharger);

  async function withClient(fn) {
    if (!isConfigured(config) || authRefused) {
      throw new Error(thrown(authRefused ? TEXT.authRefused : TEXT.notConfiguredShort));
    }
    client ??= createClient(config);
    try {
      return await fn(client);
    } catch (err) {
      if (err instanceof ZaptecError && ['auth', 'rate_limit'].includes(err.kind)) {
        await reportAccountError(err);
      }
      throw translateError(err);
    }
  }

  /** Read a device again a little later, so Gladys shows the effect. */
  function refreshSoon(read) {
    later(async () => {
      try {
        if (await ready()) {
          await read();
        }
      } catch (err) {
        logger.debug(`Refresh after the command failed (${err.message})`);
      }
    }, COMMAND_REFRESH_MS);
  }

  /** The current reading of a charger, read now when none is known. */
  async function currentReading(api, id) {
    if (!readings.get(id)) {
      const obs = observations(await api.getChargerState(id));
      readings.set(id, { obs, online: isOnline(obs, products?.chargers.get(id)?.IsOnline) });
    }
    return readings.get(id);
  }

  /**
   * pause, resume or stop (end the session), refused with a readable message
   * when Zaptec would refuse it: it rejects a command that has no effect.
   * @returns {Promise<string>} the Zaptec command sent
   */
  async function chargerCommand(id, command) {
    const name = CHARGER_COMMANDS[command];
    if (!name) {
      throw new Error(`Unknown command ${command}`);
    }
    return withClient(async (api) => {
      const { obs, online } = await currentReading(api, id);
      if (!online) {
        throw new Error(thrown(TEXT.offlineCharger));
      }
      if (!hasVehicle(opModeOf(obs))) {
        throw new Error(thrown(TEXT.noVehicle));
      }
      if (command === 'pause' && !canPause(obs)) {
        throw new Error(thrown(TEXT.notCharging));
      }
      if (command === 'resume' && !canResume(obs)) {
        throw new Error(thrown(TEXT.notPaused));
      }
      logger.info(`${chargerName(id)}: ${name}`);
      try {
        await api.command(id, name);
      } catch (err) {
        // Zaptec carries out "deauthorize and stop" but answers 500 (known
        // since 2024, see the Home Assistant integration): the reading that
        // follows shows whether it worked.
        if (!(name === 'deauthorize_and_stop' && err?.status === 500)) {
          throw err;
        }
        logger.debug(`${id}: ${name} answered HTTP 500, checked by the next reading`);
      }
      refreshSoon(() => readCharger(id));
      return name;
    });
  }

  async function onSetValue(device, feature, value) {
    const ref = parseExternalId(gladys, device.external_id);
    const key = feature.external_id.slice(device.external_id.length + 1);
    if (ref?.type === DEVICE_TYPE.CHARGER && key === CHARGER_FEATURE.CHARGE) {
      await chargerCommand(ref.id, Number(value) === 1 ? 'resume' : 'pause');
      return;
    }
    if (ref?.type === DEVICE_TYPE.INSTALLATION && key === INSTALLATION_FEATURE.AVAILABLE_CURRENT) {
      const amps = Math.round(Number(value));
      const installation = products?.installations.get(ref.id);
      if (!installation) {
        throw new Error(thrown(TEXT.unknownInstallation));
      }
      const max = installationCurrents(installation).max ?? feature.max;
      if (!Number.isFinite(amps) || amps < 0 || amps > max) {
        throw new Error(thrown(TEXT.badCurrent));
      }
      await withClient(async (api) => {
        logger.info(`${installation.Name || ref.id}: available current ${amps} A`);
        await api.setAvailableCurrent(ref.id, amps);
      });
      await gladys.publishState(feature.external_id, amps);
      refreshSoon(() => readInstallation(ref.id));
      return;
    }
    throw new Error(`${feature.external_id} cannot be controlled`);
  }

  // --- Widget ------------------------------------------------------------------

  function widgetContent({ settings, language }) {
    const lang = language ?? config.language;
    const text = (t) => pick(t, lang);
    const message = (t) => ({ ttl_seconds: 300, components: [{ type: 'text', text: text(t) }] });
    if (!isConfigured(config)) {
      return message(TEXT.notConfigured);
    }
    if (!settings?.device) {
      return message(TEXT.pickCharger);
    }
    const ref = parseExternalId(gladys, settings.device);
    if (!ref || ref.type !== DEVICE_TYPE.CHARGER) {
      return message(TEXT.notACharger);
    }
    const ids = gladys.externalIds(DEVICE_TYPE.CHARGER, ref.id);
    const reading = readings.get(ref.id);
    if (!reading) {
      return message(TEXT.noReadingYet);
    }
    const { obs, online } = reading;
    const mode = opModeOf(obs);
    const key = statusKey(obs, online);
    const statusColor = {
      charging: WIDGET_COLORS.SUCCESS,
      requesting: WIDGET_COLORS.INFO,
      paused: WIDGET_COLORS.WARNING,
      completed: WIDGET_COLORS.INFO,
      offline: WIDGET_COLORS.DANGER,
    }[key];
    const components = [
      {
        type: 'value',
        label: text(TEXT.power),
        device_feature: ids.feature(CHARGER_FEATURE.POWER),
        icon: 'zap',
      },
      {
        type: 'value',
        label: text(TEXT.session),
        device_feature: ids.feature(CHARGER_FEATURE.SESSION_ENERGY),
        icon: 'battery-charging',
      },
      {
        type: 'status',
        items: [
          {
            label: text(TEXT.status),
            value: text(STATUS[key]),
            color: statusColor ?? WIDGET_COLORS.NEUTRAL,
          },
          {
            label: text(TEXT.online),
            value: text(online ? TEXT.onlineYes : TEXT.onlineNo),
            color: online ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
          },
        ],
      },
    ];
    if (online && hasVehicle(mode)) {
      if (canPause(obs)) {
        components.push({
          type: 'button',
          label: text(TEXT.pause),
          icon: 'pause',
          action: { key: 'pause' },
        });
      } else if (canResume(obs)) {
        components.push({
          type: 'button',
          label: text(TEXT.resume),
          icon: 'play',
          action: { key: 'resume' },
        });
      }
      components.push({
        type: 'button',
        label: text(TEXT.stop),
        icon: 'square',
        style: 'danger',
        action: { key: 'stop', confirm: true },
      });
    }
    return { ttl_seconds: 60, components };
  }

  // --- Registration ------------------------------------------------------------

  async function apply(newConfig) {
    const next = normalizeConfig(newConfig);
    if (credentialsOf(next) !== credentialsOf(config)) {
      client = null;
      authRefused = false;
      pausedUntil = 0;
      readings.clear();
      lastMode.clear();
      highestIndex.clear();
    }
    config = next;
  }

  async function restart() {
    stopped = false;
    lastPolledAt.clear();
    if (await setup()) {
      await cycle({ force: true });
    }
    schedule();
  }

  function register() {
    gladys.onScanRequest(async () => {
      logger.debug('onScanRequest');
      if (await setup()) {
        await cycle();
      }
    });
    gladys.onSetValue(onSetValue);
    gladys.onPoll(async (device) => {
      const ref = parseExternalId(gladys, device.external_id);
      if (!ref || !(await ready())) {
        return;
      }
      // Fallback only: skipped while the container's timer keeps up.
      await pollDevice(device, ref, { minGap: 0.9 }).catch(() => {});
    });
    const pollNow = async (device) => {
      const ref = parseExternalId(gladys, device.external_id);
      if (!ref || !(await ready())) {
        return;
      }
      // The SDK forgot what it had published for this device: everything
      // is sent again now (the states sent before the device existed were
      // dropped by the core).
      await pollDevice(device, ref, { force: true }).catch(() => {});
      gladys.requestWidgetRefresh(WIDGET_KEY);
    };
    gladys.onDeviceCreated(pollNow);
    gladys.onDeviceUpdated(pollNow);

    gladys.onAction('test_connection', async () => {
      if (!isConfigured(config)) {
        throw new Error(thrown(TEXT.notConfiguredShort));
      }
      authRefused = false;
      pausedUntil = 0;
      client = null;
      lastAccountError = null;
      if (!(await setup())) {
        throw translateError(lastAccountError ?? new Error(thrown(TEXT.initFailed)));
      }
      logger.info('Connection test passed');
      return MESSAGES.connected(products.chargers.size, products.installations.size);
    });

    gladys.onSceneAction(SCENE_ACTION_KEY, async (fields) => {
      const id = chargerIdOf(fields.device);
      const sent = await chargerCommand(id, String(fields.command));
      return { command: sent };
    });

    gladys.onWidgetGet(WIDGET_KEY, async (request) => widgetContent(request));
    gladys.onWidgetAction(WIDGET_KEY, async (actionKey, _params, { settings } = {}) => {
      const id = chargerIdOf(settings?.device);
      const sent = await chargerCommand(id, actionKey);
      return MESSAGES.commandSent(sent, chargerName(id));
    });

    gladys.onConfigUpdated(async (newConfig) => {
      logger.info('Configuration updated');
      await apply(newConfig);
      await restart();
    });

    gladys.on('connected', async () => {
      try {
        await apply(await gladys.getConfig());
        await restart();
      } catch (err) {
        logger.error(`Initialization failed (${err.message})`);
        await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
      }
    });
  }

  return {
    register,
    cycle,
    restart,
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
    /** For the tests: the configuration in force. */
    get config() {
      return config;
    },
  };
}

const iso = (ms) => new Date(ms).toISOString();
