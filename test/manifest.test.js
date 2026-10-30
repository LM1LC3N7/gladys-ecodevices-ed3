// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULTS, LANGUAGES } from '../src/config.js';
import { ACTIONS, KINDS, POLL_INTERVAL, counterKind } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) yield* texts(entry, `${path}[${i}]`);
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('the store basics, the same version everywhere (semver, never pinned), no keywords nor countries yet', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(manifest.gladys_version, '>=5.1.0');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, '0.1.0', 'set once by hand, then by the Release workflow');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-ecodevices-ed3:${manifest.version}`);
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(pkg.version, manifest.version);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.match(
    pkg.dependencies['@gladysassistant/integration-sdk'],
    /^\^/,
    'the SDK is never pinned',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['energy', 'lighting']);
  assert.equal(manifest.keywords, undefined, 'keywords need gladys_version >= 5.3.0');
  assert.equal(manifest.countries, undefined, 'countries need gladys_version >= 5.3.0');
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    const flat = docs.replace(/\n>?\s*/g, ' ');
    assert.match(flat, /not affiliated with GCE|sans lien avec GCE/i);
    assert.match(
      flat,
      lang === 'en' ? /never tested with a real device/i : /jamais testé avec un vrai appareil/i,
    );
    assert.match(flat, /read only|lecture seule/i);
  }
  for (const file of [
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
    'docs/en.md',
    'docs/fr.md',
  ]) {
    assert.doesNotMatch(read(file), /encrypt|chiffr|hach/i, `${file}: nothing is encrypted`);
  }
  assert.doesNotMatch(JSON.stringify(manifest), /encrypt|chiffr|hach/i);
  assert.match(read('TODO.md'), /## Decisions/);
  assert.match(read('TODO.md'), /0\.1\.0/);
  assert.match(read('CHANGELOG.md'), /## \[Unreleased\]/);
});

test('the licenses ship with the image; LICENSE is the standard text, without a name', () => {
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.doesNotMatch(license, /Louis|lmilcent|LM1LC3N7|Milcent/i);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /cce66/);
  assert.match(notices, /No third-party code/);
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  assert.ok(existsSync(new URL('../cover.png', import.meta.url)));
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
  }
});

test('the configuration matches the code; the key a secret without default', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const key of Object.keys(fields)) {
    assert.doesNotMatch(key, /^gladys_/i, 'a gladys_ key is never received');
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  assert.deepEqual(
    fields.language.options.map((o) => o.value),
    LANGUAGES,
  );
  assert.equal(fields.api_key.type, 'secret');
  assert.equal(fields.api_key.default, undefined, 'no default for a secret');
  assert.equal(fields.host.required, true);
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max, fields.poll_interval.default],
    [POLL_INTERVAL.min, POLL_INTERVAL.max, POLL_INTERVAL.default],
  );
  for (const field of manifest.config_schema) {
    if (field.placeholder !== undefined)
      assert.equal(typeof field.placeholder, 'object', field.key);
    for (const option of field.options ?? []) {
      assert.equal(typeof option.value, 'string');
      for (const lang of ['en', 'fr']) assert.equal(typeof option.label[lang], 'string');
    }
  }
  const intro = fields.intro;
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
    assert.match(
      intro.description[lang],
      /Never tested with a real device|Jamais testé avec un vrai appareil/,
    );
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('the published features: no supported options, units from the core list only', async () => {
  const { buildDevice } = await import('../src/devices.js');
  const { createFakeGladys } = await import('@gladysassistant/integration-sdk/testing');
  const gladys = createFakeGladys({ selector: 'ed3' });
  // DEVICE_FEATURE_UNITS_BY_CATEGORY of the core (server/utils/constants.js), for ours.
  const units = {
    'temperature-sensor': ['celsius'],
    'humidity-sensor': ['percent'],
    'light-sensor': ['lux'],
    'energy-sensor': ['watt', 'volt', 'kilowatt-hour'],
    'energy-production-sensor': ['kilowatt-hour'],
    'grid-sensor': ['kilowatt-hour'],
    'volume-sensor': ['cubicmeter'],
  };
  const targets = [
    { code: 'r1', kind: KINDS.RELAY, n: 1 },
    { code: 'x8r4259840-1', kind: KINDS.RELAY, n: 1, ext: 4259840 },
    { code: 'xthl1', kind: KINDS.THL },
    { code: 't1', kind: KINDS.CLAMP, n: 1 },
    { code: 'mains', kind: KINDS.MAINS },
    ...Array.from({ length: 30 }, (_, n) => ({
      code: `c${n}`,
      kind: KINDS.COUNTER,
      n,
      counter: counterKind(n),
    })),
  ];
  for (const target of targets) {
    for (const relayKind of target.kind === KINDS.RELAY
      ? [undefined, 'switch', 'light']
      : [undefined]) {
      const device = buildDevice(gladys, target, { language: 'fr', relayKind });
      for (const f of device.features) {
        if (f.unit !== undefined) {
          assert.ok(units[f.category]?.includes(f.unit), `${f.category} ${f.unit}`);
        } else {
          assert.equal(f.category, f.type === 'binary' ? f.category : 'unknown', f.external_id);
        }
        assert.equal(f.supported_options, undefined, 'none published');
        assert.ok(f.min <= f.max, f.external_id);
        if (f.category === 'switch' || f.category === 'light') {
          assert.equal(
            f.read_only,
            relayKind === undefined,
            `a ${f.category} is commandable only when declared`,
          );
        } else {
          assert.equal(f.read_only, true, f.external_id);
        }
        // The energy monitoring counts these: consumption only, never injection nor gas.
        if (f.category === 'energy-sensor' && f.type === 'index') {
          assert.ok(['tic-total', 'consumption'].includes(target.counter), target.code);
        }
      }
    }
  }
});

test('the slots of the other ED3: every key of slotConfig in the manifest, the keys secret', async () => {
  const { SLOTS, slotConfig } = await import('../src/config.js');
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (let slot = 2; slot <= SLOTS; slot += 1) {
    const raw = Object.fromEntries(Object.keys(fields).map((key) => [key, key]));
    for (const [name, from] of Object.entries(slotConfig(raw, slot))) {
      assert.ok(fields[from], `${name} of slot ${slot} (${from}) not in the manifest`);
    }
    assert.equal(fields[`api_key_${slot}`].type, 'secret');
    assert.equal(fields[`api_key_${slot}`].default, undefined);
    assert.equal(fields[`host_${slot}`].required, false);
    assert.match(fields[`relays_${slot}`].description.en, /never list a pump/);
  }
  const attach = manifest.actions.find((a) => a.key === ACTIONS.ATTACH);
  assert.deepEqual(
    attach.fields[0].options.map((o) => o.value),
    Array.from({ length: SLOTS }, (_, i) => String(i + 1)),
  );
});
