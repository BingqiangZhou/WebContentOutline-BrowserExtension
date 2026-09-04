// Chrome validates messages.json placeholder schema while loading an
// unpacked extension; one malformed entry rejects the whole manifest
// ("Invalid placeholder content for key ...", could not load manifest).
// WXT copies locales into .output without validating them, so guard the
// schema here: every placeholder must be an object whose content is a
// "$N" substitution, and $VAR$ references and placeholder definitions
// must agree (case-insensitively, matching Chrome's lookup — the official
// format uses lowercase keys with uppercase $NAME$ in messages).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LOCALES = fs.readdirSync(path.join(repoRoot, 'public/_locales'))
  .filter((name) => fs.existsSync(path.join(repoRoot, 'public/_locales', name, 'messages.json')));

function readMessages(locale) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, 'public/_locales', locale, 'messages.json'), 'utf8'));
}

function referencedNames(message) {
  const names = new Set();
  for (const m of String(message).matchAll(/\$([A-Za-z0-9_]+)\$/g)) {
    names.add(m[1].toLowerCase());
  }
  return names;
}

test('every locale ships a valid i18n placeholder schema', () => {
  assert.ok(LOCALES.length > 0, 'at least one locale must exist');
  for (const locale of LOCALES) {
    const messages = readMessages(locale);
    for (const [key, entry] of Object.entries(messages)) {
      const referenced = referencedNames(entry.message);
      const placeholders = entry.placeholders;

      if (referenced.size > 0) {
        assert.ok(placeholders, `${locale}/${key}: message uses $VAR$ but has no placeholders block`);
      }
      if (!placeholders) continue;

      const defined = new Set(Object.keys(placeholders).map((n) => n.toLowerCase()));
      for (const ref of referenced) {
        assert.ok(defined.has(ref), `${locale}/${key}: message references $${ref}$ but no placeholder defines it`);
      }
      for (const name of defined) {
        assert.ok(referenced.has(name), `${locale}/${key}: placeholder "${name}" is defined but never referenced by the message`);
      }
      for (const [name, def] of Object.entries(placeholders)) {
        assert.ok(
          def && typeof def === 'object' && !Array.isArray(def),
          `${locale}/${key}: placeholder "${name}" must be an object with a content field (got ${JSON.stringify(def)})`
        );
        assert.match(
          def.content,
          /^\$\d+$/,
          `${locale}/${key}: placeholder "${name}" content must be a substitution like "$1"`
        );
      }
    }
  }
});
