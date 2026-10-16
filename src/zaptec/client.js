// -----------------------------------------------------------------------------
// Client of the official Zaptec cloud API (https://api.zaptec.com), the one
// the Zaptec Portal account gives access to and the Home Assistant
// integration (custom-components/zaptec) uses.
//
//   - Login: OAuth2 "password" grant, POST /oauth/token with the account's
//     e-mail address and password (form encoded). The answer is an access
//     token valid about one day, without a refresh token: once expired, the
//     client logs in again. The token is kept in /data (src/store.js) so a
//     restart does not log in again.
//   - Every call carries the token; a 401 logs in again once.
//   - Only DOCUMENTED endpoints are called: Zaptec's API fair use policy
//     forbids the internal ones (the Home Assistant integration's
//     `authorizecharge` is one of them, so it is not here).
//   - Errors are typed (ZaptecError.kind) so the callers can tell refused
//     credentials (stop and say so: retrying could lock the account) from a
//     rate limit (wait), missing rights (403), a cloud outage (retry later) or
//     a refused command.
//
// Nothing here logs: the messages of the errors carry the HTTP status, never
// a token, a password or the request body.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const ZAPTEC_API = 'https://api.zaptec.com';

/** Log in again this long before the token expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Charger commands (POST /api/chargers/{id}/sendCommand/{commandId}), as the
 * Zaptec documentation lists them. Restart and firmware upgrade (102, 200)
 * are left out on purpose: nothing in Gladys needs them.
 */
export const COMMAND_IDS = {
  stop_charging_final: 506, // pause: the vehicle stays plugged in, the session goes on
  resume_charging: 507, // resume after a 506
  deauthorize_and_stop: 10001, // end the session (a new authorization is needed)
};

export class ZaptecError extends Error {
  /**
   * @param {'auth'|'rate_limit'|'forbidden'|'refused'|'not_found'|'server'|'network'} kind
   * @param {string} message
   * @param {{ status?: number, retryAfterMs?: number }} [details]
   */
  constructor(kind, message, { status, retryAfterMs } = {}) {
    super(message);
    this.name = 'ZaptecError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Short, stable fingerprint of an account: the token file belongs to one. */
export function accountKey(username) {
  return createHash('sha256').update(String(username)).digest('hex').slice(0, 16);
}

/**
 * @param {object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {{ load: () => Promise<object|null>, save: (t: object) => Promise<void>, clear: () => Promise<void> }} [options.tokenStore]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.baseUrl]
 * @param {string} [options.userAgent]
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 */
export function createZaptecClient({
  username,
  password,
  tokenStore = memoryTokenStore(),
  fetch: fetchImpl = globalThis.fetch,
  baseUrl = ZAPTEC_API,
  userAgent = 'gladys-zaptec',
  now = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const account = accountKey(username);
  let token = null;
  let loaded = false;
  // One login at a time: parallel calls wait for the same one.
  let renewing = null;

  async function send(method, path, { json, form, auth = true } = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': userAgent };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    if (auth) {
      headers.Authorization = `Bearer ${token.accessToken}`;
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : (err?.cause?.code ?? err?.message);
      throw new ZaptecError('network', `Zaptec cloud unreachable (${reason})`);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { status: response.status, ok: response.ok, headers: response.headers, data };
  }

  function errorFrom(res, what) {
    const message = `${what} failed (HTTP ${res.status})`;
    if (res.status === 429) {
      return new ZaptecError('rate_limit', message, {
        status: 429,
        retryAfterMs: retryAfterMs(res.headers?.get?.('retry-after')),
      });
    }
    if (res.status === 403) {
      return new ZaptecError('forbidden', message, { status: 403 });
    }
    if (res.status === 404) {
      return new ZaptecError('not_found', message, { status: 404 });
    }
    if (res.status >= 500) {
      return new ZaptecError('server', message, { status: res.status });
    }
    return new ZaptecError('refused', message, { status: res.status });
  }

  async function login() {
    const res = await send('POST', '/oauth/token', {
      form: { grant_type: 'password', username, password },
      auth: false,
    });
    if (!res.ok) {
      // 400 "invalid_grant" (and 401) mean the account refuses these credentials.
      if (res.status === 400 || res.status === 401) {
        token = null;
        await tokenStore.clear().catch(() => {});
        throw new ZaptecError('auth', `Zaptec refused the credentials (HTTP ${res.status})`, {
          status: res.status,
        });
      }
      throw errorFrom(res, 'Zaptec login');
    }
    const data = res.data;
    if (!data || typeof data.access_token !== 'string' || !data.access_token) {
      throw new ZaptecError('server', 'Zaptec login answered without a token');
    }
    const expiresIn = Number(data.expires_in);
    token = {
      account,
      accessToken: data.access_token,
      expiresAt: now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 3600000),
    };
    await tokenStore.save(token).catch(() => {});
  }

  function renew() {
    if (!renewing) {
      renewing = login().finally(() => {
        renewing = null;
      });
    }
    return renewing;
  }

  async function ensureToken() {
    if (!loaded) {
      loaded = true;
      const saved = await tokenStore.load().catch(() => null);
      if (saved?.account === account && saved.accessToken) {
        token = saved;
      }
    }
    if (!token || token.expiresAt - EXPIRY_MARGIN_MS <= now()) {
      await renew();
    }
  }

  async function call(method, path, what, json) {
    await ensureToken();
    let res = await send(method, path, { json });
    if (res.status === 401) {
      await renew();
      res = await send(method, path, { json });
    }
    if (!res.ok) {
      throw errorFrom(res, what);
    }
    return { status: res.status, data: res.data };
  }

  const id = (value) => encodeURIComponent(String(value));

  return {
    /** Check the credentials: logs in when no valid token is known. */
    async connect() {
      await ensureToken();
    },
    /** Chargers the account can see: [{ Id, Name, DeviceId, InstallationId, ... }]. */
    async getChargers() {
      const { data } = await call('GET', '/api/chargers', 'Reading the chargers');
      return Array.isArray(data?.Data) ? data.Data : [];
    },
    /** The observations of a charger: [{ StateId, ValueAsString, Timestamp }]. */
    async getChargerState(chargerId) {
      const { data } = await call(
        'GET',
        `/api/chargers/${id(chargerId)}/state`,
        'Reading the charger state',
      );
      return Array.isArray(data) ? data : [];
    },
    /**
     * An installation (current limits), or null when the account may not read
     * it: Zaptec answers 403, or since 2025 an empty 204, to a plain user.
     */
    async getInstallation(installationId) {
      try {
        const { status, data } = await call(
          'GET',
          `/api/installation/${id(installationId)}`,
          'Reading the installation',
        );
        return status === 204 || !data || typeof data !== 'object' ? null : data;
      } catch (err) {
        if (err instanceof ZaptecError && err.kind === 'forbidden') {
          return null;
        }
        throw err;
      }
    },
    /** The current available to the whole installation, on all three phases. */
    async setAvailableCurrent(installationId, amps) {
      await call(
        'POST',
        `/api/installation/${id(installationId)}/update`,
        'Changing the installation current',
        { availableCurrent: amps },
      );
    },
    /** stop_charging_final, resume_charging or deauthorize_and_stop. */
    async command(chargerId, name) {
      const commandId = COMMAND_IDS[name];
      if (!commandId) {
        throw new Error(`Unknown Zaptec command ${name}`);
      }
      await call(
        'POST',
        `/api/chargers/${id(chargerId)}/sendCommand/${commandId}`,
        `Command ${name}`,
      );
    },
  };
}

/** Retry-After in milliseconds (seconds or an HTTP date), undefined when absent. */
export function retryAfterMs(header, now = Date.now()) {
  if (header === null || header === undefined || header === '') {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** A token store that forgets everything at exit (tests, probe). */
export function memoryTokenStore() {
  let saved = null;
  return {
    async load() {
      return saved;
    },
    async save(token) {
      saved = { ...token };
    },
    async clear() {
      saved = null;
    },
  };
}
