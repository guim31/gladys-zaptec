// -----------------------------------------------------------------------------
// A fake Zaptec cloud, as a `fetch` implementation: no network in the tests.
//
// It serves the fixtures of test/fixtures/zaptec, checks the bearer token like
// the real API (401 without a valid one), applies the documented command
// rules (506 only while charging, 507 only after a 506) and records every
// request. The tests change its data (a vehicle plugged in, a charger
// offline) or make it fail (`fail` = next answers) to drive the integration.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/zaptec/${name}.json`, import.meta.url), 'utf8'));

export const ACCOUNT = { username: 'owner@example.com', password: 'correct horse battery' };

export const GO = '00000000-0000-4000-8000-0000000a0101';
export const PRO = '00000000-0000-4000-8000-0000000b0202';
export const INSTALLATION = '00000000-0000-4000-8000-00000000aaaa';
export const OTHER_INSTALLATION = '00000000-0000-4000-8000-00000000bbbb';

/** A state fixture with some observations replaced: { 710: '5', 718: '1' }. */
export function withObservations(state, values) {
  const out = state.filter((o) => !(String(o.StateId) in values));
  for (const [id, value] of Object.entries(values)) {
    if (value !== undefined) {
      out.push({ ChargerId: state[0]?.ChargerId, StateId: Number(id), ValueAsString: value });
    }
  }
  return out;
}

const valueOf = (state, id) => state.find((o) => o.StateId === id)?.ValueAsString;

export function createFakeZaptec() {
  let tokenCount = 0;
  const zaptec = {
    username: ACCOUNT.username,
    password: ACCOUNT.password,
    validTokens: new Set(),
    chargers: fixture('chargers'),
    states: {
      [GO]: fixture('charger-state-charging'),
      [PRO]: fixture('charger-state-disconnected'),
    },
    installations: { [INSTALLATION]: fixture('installation') },
    /** Every request: { method, path, body, form, auth }. */
    requests: [],
    /** Queued failures: { path?: RegExp, status, body?, headers?, network? }, used once each. */
    fail: [],
    /** The real API answers 500 to "deauthorize and stop", yet carries it out. */
    deauthorizeAnswers500: true,
    /** Lifetime of the tokens, in seconds. */
    expiresIn: 86399,

    paths(method) {
      return zaptec.requests.filter((r) => !method || r.method === method).map((r) => r.path);
    },

    fetch: async (url, init = {}) => {
      const { pathname } = new URL(url);
      const method = init.method ?? 'GET';
      const isForm = init.headers?.['Content-Type'] === 'application/x-www-form-urlencoded';
      const form = isForm ? Object.fromEntries(new URLSearchParams(init.body)) : undefined;
      const body = init.body && !isForm ? JSON.parse(init.body) : undefined;
      const auth = init.headers?.Authorization;
      zaptec.requests.push({ method, path: pathname, body, form, auth });

      const failure = zaptec.fail.findIndex((f) => !f.path || f.path.test(pathname));
      if (failure !== -1) {
        const [f] = zaptec.fail.splice(failure, 1);
        if (f.network) {
          throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
        }
        return respond(f.status, 'body' in f ? f.body : { Message: 'Failure' }, f.headers);
      }

      if (method === 'POST' && pathname === '/oauth/token') {
        if (
          form?.grant_type !== 'password' ||
          form.username !== zaptec.username ||
          form.password !== zaptec.password
        ) {
          return respond(400, fixture('token-refused'));
        }
        return respond(200, newToken());
      }
      const token = auth?.replace(/^Bearer /, '');
      if (!zaptec.validTokens.has(token)) {
        return respond(401, { Message: 'Authorization has been denied for this request.' });
      }

      let match;
      if (method === 'GET' && pathname === '/api/chargers') {
        return respond(200, zaptec.chargers);
      }
      if (method === 'GET' && (match = pathname.match(/^\/api\/chargers\/([^/]+)\/state$/))) {
        return found(zaptec.states[match[1]]);
      }
      if (method === 'GET' && (match = pathname.match(/^\/api\/installation\/([^/]+)$/))) {
        const installation = zaptec.installations[match[1]];
        return installation ? respond(200, installation) : respond(403, { Message: 'Forbidden' });
      }
      if (method === 'POST' && (match = pathname.match(/^\/api\/installation\/([^/]+)\/update$/))) {
        const installation = zaptec.installations[match[1]];
        if (!installation) {
          return respond(403, { Message: 'Forbidden' });
        }
        const amps = body.availableCurrent;
        zaptec.installations[match[1]] = {
          ...installation,
          AvailableCurrent: amps,
          AvailableCurrentPhase1: amps,
          AvailableCurrentPhase2: amps,
          AvailableCurrentPhase3: amps,
        };
        return respond(200, null);
      }
      if (
        method === 'POST' &&
        (match = pathname.match(/^\/api\/chargers\/([^/]+)\/sendCommand\/(\d+)$/))
      ) {
        const [, id, command] = match;
        const state = zaptec.states[id];
        if (!state) {
          return respond(404, { Message: 'Not found' });
        }
        const mode = valueOf(state, 710);
        const finalStop = valueOf(state, 718) === '1';
        if (command === '506') {
          if (mode !== '3') {
            return respond(400, { Message: 'Charging is not active' });
          }
          zaptec.states[id] = withObservations(state, { 710: '5', 718: '1', 513: '0.000' });
          return respond(200, null);
        }
        if (command === '507') {
          if (mode !== '5' || !finalStop) {
            return respond(400, { Message: 'Charging is not Paused nor Scheduled' });
          }
          zaptec.states[id] = withObservations(state, { 710: '3', 718: '0' });
          return respond(200, null);
        }
        if (command === '10001') {
          zaptec.states[id] = withObservations(state, { 710: '2', 718: '0', 513: '0.000' });
          return zaptec.deauthorizeAnswers500
            ? respond(500, { Message: 'An error has occurred.' })
            : respond(200, null);
        }
        return respond(400, { Message: 'Unknown command' });
      }
      return respond(404, { Message: 'Not found' });
    },
  };

  function newToken() {
    tokenCount += 1;
    const accessToken = `token-${tokenCount}`;
    zaptec.validTokens.add(accessToken);
    return { ...fixture('token-ok'), access_token: accessToken, expires_in: zaptec.expiresIn };
  }

  function found(data) {
    return data ? respond(200, data) : respond(404, { Message: 'Not found' });
  }

  function respond(status, data, headers = {}) {
    return new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  }

  return zaptec;
}
