/**
 * Static check of the compiled TUI part: `node scripts/check-tui.mjs [dist/tui.js]`.
 *
 * dist/tui.js cannot be imported outside OpenCode (its runtime modules come
 * from the host), so this parses it and every file it reaches through
 * relative imports, and fails when:
 * - a file does not parse, or a relative import points at a missing file
 *   (for example a path left as ../dist/ or missing from the npm tarball);
 * - a bare import is anything but node: builtins or the host runtime
 *   modules (`solid-js`, `@opentui/solid`), which OpenCode maps for files
 *   under node_modules;
 * - `@opentui/solid` is imported by name (a missing export would be a link
 *   error for the whole module), or the compiled code uses a helper that
 *   OpenCode's @opentui/solid does not export. A new babel-preset-solid that
 *   emits a new helper fails here instead of on users' machines;
 * - a generated `_$` helper is referenced but never imported or declared
 *   (a broken import rewrite in scripts/build-tui.mjs).
 */

import { transformAsync } from '@babel/core';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

// The compile-time helpers in @opentui/solid's exports as of OpenCode 2.3.2.
const HOST_HELPERS = new Set([
  'createComponent',
  'createElement',
  'createTextNode',
  'effect',
  'insert',
  'insertNode',
  'memo',
  'mergeProps',
  'setProp',
  'spread',
  'use',
]);
const HOST_RUNTIME = new Set(['solid-js', '@opentui/solid']);
const HELPERS = '_$opentui'; // namespace name chosen by scripts/build-tui.mjs

const entry = resolve(process.argv[2] ?? 'dist/tui.js');
const problems = [];
const seen = new Set();

function collect({ types: t }, found) {
  const record = (path, value) => found.push({ value, line: path.node.loc?.start.line });
  return {
    visitor: {
      ImportDeclaration(path) {
        record(path, path.node.source.value);
        if (path.node.source.value === '@opentui/solid') {
          for (const spec of path.node.specifiers) {
            if (!t.isImportNamespaceSpecifier(spec)) {
              found.named.push({ name: spec.local.name, line: path.node.loc?.start.line });
            }
          }
        }
      },
      'ExportNamedDeclaration|ExportAllDeclaration'(path) {
        if (path.node.source) record(path, path.node.source.value);
      },
      CallExpression(path) {
        const [arg] = path.node.arguments;
        if (t.isImport(path.node.callee) && t.isStringLiteral(arg)) record(path, arg.value);
      },
      Identifier(path) {
        const { name } = path.node;
        if (name.startsWith('_$') && path.isReferencedIdentifier() && !path.scope.hasBinding(name)) {
          found.unbound.push({ name, line: path.node.loc?.start.line });
        }
      },
      MemberExpression(path) {
        const { object, property, computed } = path.node;
        if (t.isIdentifier(object, { name: HELPERS }) && !computed && t.isIdentifier(property)) {
          found.helpers.push({ name: property.name, line: path.node.loc?.start.line });
        }
      },
    },
  };
}

async function check(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const where = relative(process.cwd(), file);
  const found = Object.assign([], { named: [], helpers: [], unbound: [] });
  try {
    await transformAsync(await readFile(file, 'utf8'), {
      filename: file,
      configFile: false,
      babelrc: false,
      code: false,
      sourceType: 'module',
      plugins: [(api) => collect(api, found)],
    });
  } catch (err) {
    problems.push(`${where}: does not parse: ${err.message}`);
    return;
  }

  for (const { name, line } of found.named) {
    problems.push(`${where}:${line}: named import ${name} from @opentui/solid (use a namespace import)`);
  }
  for (const { name, line } of found.unbound) {
    problems.push(`${where}:${line}: ${name} is used but never imported or declared`);
  }
  for (const { name, line } of found.helpers) {
    if (!HOST_HELPERS.has(name)) {
      problems.push(`${where}:${line}: helper ${name} is not exported by OpenCode's @opentui/solid`);
    }
  }

  const next = [];
  for (const { value, line } of found) {
    if (value.startsWith('.') || value.startsWith('/')) {
      const target = resolve(dirname(file), value);
      if (!existsSync(target)) problems.push(`${where}:${line}: ${value} does not exist`);
      else next.push(target);
    } else if (!value.startsWith('node:') && !HOST_RUNTIME.has(value)) {
      problems.push(`${where}:${line}: ${value} is not provided by OpenCode`);
    }
  }
  for (const target of next) await check(target);
}

if (!existsSync(entry)) {
  problems.push(`${relative(process.cwd(), entry)} does not exist`);
} else {
  await check(entry);
}

if (problems.length > 0) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(`checked ${seen.size} files from ${relative(process.cwd(), entry)}`);
