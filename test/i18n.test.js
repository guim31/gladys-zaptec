// -----------------------------------------------------------------------------
// Every text Gladys shows exists in the four languages of its interface
// (English, French, German, Spanish): the manifest, the message tables of the
// code, the feature names, and the four documentation pages, which keep the
// same sections. German says "du", never the polite "Sie".
// -----------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { MESSAGES, NAMES, STATUS, TEXT, thrown } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const LANGS = ['en', 'fr', 'de', 'es'];
const POLITE_GERMAN = /(?<!\p{L})(Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres)(?!\p{L})/u;

// Upper bounds, in characters: what the Gladys interface shows without cutting.
const MAX = {
  catalog: 100,
  widgetLabel: 30,
  label: 60,
  placeholder: 60,
  description: 300,
  message: 200,
  short: 24,
  status: 40,
  featureName: 40,
};

const sorted = (keys) => [...keys].sort();

/** Checks one multi-language object; returns its problems. */
function problems(value, path, max) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [`${path} must be a multi-language object`];
  }
  const found = [];
  if (JSON.stringify(sorted(Object.keys(value))) !== JSON.stringify(sorted(LANGS))) {
    found.push(`${path} has [${Object.keys(value)}], expected exactly [${LANGS}]`);
  }
  for (const [lang, text] of Object.entries(value)) {
    found.push(...textProblems(text, `${path}.${lang}`, lang, max));
  }
  return found;
}

function textProblems(text, path, lang, max) {
  if (typeof text !== 'string' || text.trim() === '') {
    return [`${path} is empty`];
  }
  const found = [];
  if (text.length > max) {
    found.push(`${path} has ${text.length} characters (${max} at most)`);
  }
  if (lang === 'de' && POLITE_GERMAN.test(text)) {
    found.push(`${path} uses the polite form: "${text}"`);
  }
  return found;
}

/** Every multi-language object of the manifest, with its length limit. */
function manifestTexts(root) {
  const texts = [];
  const walk = (value, path, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, key));
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const isText =
      ['label', 'description', 'placeholder'].includes(key) ||
      Object.keys(value).some((child) => LANGS.includes(child));
    if (isText) {
      const max =
        path === 'manifest.description' || /^manifest\.widgets\[\d+\]\.description$/.test(path)
          ? MAX.catalog
          : /^manifest\.widgets\[\d+\]\.label$/.test(path)
            ? MAX.widgetLabel
            : (MAX[key] ?? MAX.label);
      texts.push({ path, value, max });
      return;
    }
    for (const [child, item] of Object.entries(value)) {
      walk(item, `${path}.${child}`, child);
    }
  };
  walk(root, 'manifest', null);
  return texts;
}

test('the configuration offers the four languages, French by default', () => {
  assert.deepEqual(LANGUAGES, LANGS);
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.deepEqual(
    field.options.map((o) => o.value),
    LANGS,
  );
  assert.equal(field.default, 'fr');
});

test('every text of the manifest is in English, French, German and Spanish', () => {
  const texts = manifestTexts(manifest);
  assert.ok(texts.length >= 40, `only ${texts.length} texts found in the manifest`);
  const found = texts.flatMap(({ path, value, max }) => problems(value, path, max));
  assert.deepEqual(found, []);
});

test('the name is the same in every language, and short', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});

test('every message table of the code has the four languages', () => {
  const longText = new Set([
    'pickCharger',
    'notACharger',
    'notConfigured',
    'noReadingYet',
    'authRefused',
    'initFailed',
    'noVehicle',
    'notCharging',
    'notPaused',
    'offlineCharger',
    'unknownCharger',
    'unknownInstallation',
    'notConfiguredShort',
    'commandRefused',
    'forbidden',
    'cloudUnreachable',
    'rateLimited',
    'badCurrent',
  ]);
  const found = [
    ...Object.entries(TEXT).flatMap(([key, value]) =>
      problems(value, `TEXT.${key}`, longText.has(key) ? MAX.message : MAX.short),
    ),
    ...Object.entries(STATUS).flatMap(([key, value]) =>
      problems(value, `STATUS.${key}`, MAX.status),
    ),
    ...problems(MESSAGES.connected(2, 1), 'MESSAGES.connected', MAX.message),
    ...problems(MESSAGES.unreachable('HTTP 503'), 'MESSAGES.unreachable', MAX.message),
    ...['stop_charging_final', 'resume_charging', 'deauthorize_and_stop'].flatMap((c) =>
      problems(MESSAGES.commandSent(c, 'Garage'), `MESSAGES.commandSent(${c})`, MAX.message),
    ),
  ];
  assert.deepEqual(found, []);
});

test('a refusal a widget button can meet fits in a toast once the languages are joined', () => {
  // A thrown message reaches the user as one string, the four languages joined;
  // the core cuts a widget toast at 200 characters.
  for (const key of [
    'noVehicle',
    'notCharging',
    'notPaused',
    'offlineCharger',
    'unknownCharger',
    'commandRefused',
    'cloudUnreachable',
    'rateLimited',
  ]) {
    const text = thrown(TEXT[key]);
    assert.ok(text.length <= 200, `TEXT.${key} joined has ${text.length} characters`);
  }
});

test('the feature names exist in every language, distinct on each device', () => {
  assert.deepEqual(Object.keys(NAMES), LANGS);
  const found = [];
  for (const lang of LANGS) {
    if (JSON.stringify(Object.keys(NAMES[lang])) !== JSON.stringify(Object.keys(NAMES.en))) {
      found.push(`NAMES.${lang} does not have the keys of NAMES.en`);
    }
    for (const [key, value] of Object.entries(NAMES[lang])) {
      found.push(...textProblems(value, `NAMES.${lang}.${key}`, lang, MAX.featureName));
    }
    const values = Object.values(NAMES[lang]);
    if (new Set(values).size !== values.length) {
      found.push(`NAMES.${lang} has twice the same name`);
    }
  }
  assert.deepEqual(found, []);
});

// The documentation pages: same sections, in the same order.
const SECTIONS = {
  en: [
    'Overview',
    'Requirements',
    'Configuration',
    'Devices',
    'Widget',
    'Scene triggers and action',
    'Scene examples',
    'Troubleshooting',
    'Limitations',
  ],
  fr: [
    'Présentation',
    'Prérequis',
    'Configuration',
    'Appareils',
    'Widget',
    'Déclencheurs et action de scène',
    'Exemples de scènes',
    'Dépannage',
    'Limites',
  ],
  de: [
    'Überblick',
    'Voraussetzungen',
    'Konfiguration',
    'Geräte',
    'Widget',
    'Szenen-Auslöser und -Aktion',
    'Szenenbeispiele',
    'Fehlerbehebung',
    'Einschränkungen',
  ],
  es: [
    'Presentación',
    'Requisitos',
    'Configuración',
    'Dispositivos',
    'Widget',
    'Desencadenantes y acción de escena',
    'Ejemplos de escenas',
    'Solución de problemas',
    'Limitaciones',
  ],
};

async function docSections(lang) {
  const text = await readFile(new URL(`../docs/${lang}.md`, import.meta.url), 'utf8');
  return {
    text,
    sections: [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1].trim()),
    subsections: [...text.matchAll(/^### /gm)].length,
  };
}

test('the four documentation pages have the same sections', async () => {
  const docs = Object.fromEntries(
    await Promise.all(LANGS.map(async (l) => [l, await docSections(l)])),
  );
  for (const lang of LANGS) {
    assert.deepEqual(docs[lang].sections, SECTIONS[lang], `docs/${lang}.md sections`);
    assert.equal(
      docs[lang].subsections,
      docs.en.subsections,
      `docs/${lang}.md has ${docs[lang].subsections} subsections, docs/en.md ${docs.en.subsections}`,
    );
    assert.ok(docs[lang].text.length >= 300, `docs/${lang}.md is too short`);
    assert.match(docs[lang].text, /Zaptec/);
  }
  assert.doesNotMatch(docs.de.text, POLITE_GERMAN, 'docs/de.md uses the polite form');
});

test('the guard catches a missing language, an empty text and the polite German form', () => {
  assert.equal(problems({ en: 'Power', fr: 'Puissance', de: 'Leistung' }, 'x', 60).length, 1);
  assert.equal(
    problems({ en: 'Power', fr: 'Puissance', de: '', es: 'Potencia' }, 'x', 60).length,
    1,
  );
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a', es: 'a', it: 'a' }, 'x', 60).length, 1);
  assert.equal(problems({ en: 'a', fr: 'a', de: 'a'.repeat(61), es: 'a' }, 'x', 60).length, 1);
  for (const polite of ['Wählen Sie', 'Ihr Gerät', 'Ihre Ladestation', 'mit Ihrem', 'Ihren']) {
    assert.equal(problems({ en: 'a', fr: 'a', de: polite, es: 'a' }, 'x', 60).length, 1, polite);
  }
  // Words that only contain the letters stay allowed.
  assert.deepEqual(
    problems({ en: 'a', fr: 'a', de: 'Siebenschläfer, ihre', es: 'a' }, 'x', 60),
    [],
  );
  // A manifest text forgotten in German is found.
  const forgotten = structuredClone(manifest);
  delete forgotten.scene_actions[0].fields[1].label.de;
  const found = manifestTexts(forgotten).flatMap(({ path, value, max }) =>
    problems(value, path, max),
  );
  assert.deepEqual(found, [
    'manifest.scene_actions[0].fields[1].label has [en,fr,es], expected exactly [en,fr,de,es]',
  ]);
});
