// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the manifest `config_schema`. The SDK
// fetches it (`gladys.getConfig()`) and pushes every change
// (`gladys.onConfigUpdated()`); this module only provides the defaults and
// normalizes the received object, so the rest of the code never deals with
// `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, in the order every text carries them. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * Refresh intervals offered in the configuration, in seconds (select values).
 * One to five minutes: Zaptec asks API users not to poll aggressively (its
 * fair use policy), and the Home Assistant integration had to slow down too.
 */
export const POLL_INTERVALS = ['60', '120', '300'];

// MUST stay equal to the `default` values of the manifest config_schema
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  username: '', // login of the Zaptec Portal / Zaptec app account (an e-mail address)
  password: '',
  language: 'fr', // language of the feature names and of the texts built here
  poll_interval: '120', // seconds between two readings of the Zaptec cloud
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  const language = String(source.language ?? DEFAULT_CONFIG.language);
  const interval = String(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  return {
    username: String(source.username ?? DEFAULT_CONFIG.username).trim(),
    password: String(source.password ?? DEFAULT_CONFIG.password),
    language: LANGUAGES.includes(language) ? language : DEFAULT_CONFIG.language,
    poll_interval: POLL_INTERVALS.includes(interval) ? interval : DEFAULT_CONFIG.poll_interval,
  };
}

/** The account can only be reached once both fields are filled in. */
export function isConfigured(config) {
  return Boolean(config.username && config.password);
}

/** Period of the container's own refresh timer, in milliseconds. */
export function pollPeriodMs(config) {
  return Number(config.poll_interval) * 1000;
}
