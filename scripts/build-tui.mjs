/**
 * Compile the TUI part (src/tui.tsx) to plain JavaScript in dist/tui.js.
 *
 * OpenCode applies its Solid/OpenTUI JSX transform only to plugin sources
 * outside node_modules (the loader's onLoad filter excludes that path). A
 * plugin installed with `opencode plugin add` lives in node_modules, so a
 * shipped .tsx would be compiled by Bun's default TSX loader instead, which
 * emits a React JSX runtime import and fails with "Cannot find package
 * 'react'". Precompiling here removes JSX from the published artifact.
 *
 * Options match OpenCode 2.3's own transform: babel-preset-solid with the
 * OpenTUI runtime module and universal output, plus the TypeScript preset.
 * The generated imports (`@opentui/solid`, `solid-js`) are runtime
 * specifiers: OpenCode's loader (opentui runtime-modules plugin,
 * `nodeModulesRuntimeSpecifiers: true` by default) rewrites them to the
 * host's own modules even for files under node_modules.
 *
 * A second Babel pass then:
 * - turns the preset's named helper imports from `@opentui/solid` into one
 *   namespace import, so a helper the host lacks is `undefined` where it is
 *   used instead of a link error that takes down the whole module (the same
 *   reason src/tui.tsx imports @opentui/solid as a namespace);
 * - rewrites `../dist/tui-support.js` to `./tui-support.js`: tui.tsx imports
 *   the emitted declarations from ../dist/ so `npm run typecheck` checks that
 *   build, while the compiled file lives in dist/ itself.
 *
 * scripts/check-tui.mjs verifies the result (CI and release).
 */

import { transformAsync } from '@babel/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'src/tui.tsx');
const output = resolve(root, 'dist/tui.js');

const SUPPORT_FROM = '../dist/tui-support.js';
const SUPPORT_TO = './tui-support.js';
const RUNTIME = '@opentui/solid';
const HELPERS = '_$opentui';

function rewriteImports({ types: t }) {
  return {
    name: 'zai-limits-rewrite-imports',
    visitor: {
      Program(program, state) {
        state.supportRewrites = 0;
        const helpers = [];
        const helperImports = [];
        for (const path of program.get('body')) {
          const { node } = path;
          if (!node.source) continue; // only import/export ... from

          if (node.source.value === SUPPORT_FROM) {
            node.source = t.stringLiteral(SUPPORT_TO);
            state.supportRewrites++;
            continue;
          }

          // The preset's helpers: named imports with Solid's `_$` prefix.
          // The hand-written `import * as opentui` in tui.tsx is left alone.
          if (
            path.isImportDeclaration() &&
            node.source.value === RUNTIME &&
            node.specifiers.length > 0 &&
            node.specifiers.every((s) => t.isImportSpecifier(s) && s.local.name.startsWith('_$'))
          ) {
            for (const spec of node.specifiers) {
              const imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
              helpers.push({ local: spec.local.name, imported });
            }
            helperImports.push(path);
          }
        }

        if (helpers.length === 0) return;
        if (program.scope.hasBinding(HELPERS)) {
          throw new Error(`${HELPERS} is already bound in ${source}`);
        }
        // Replace the references while the import bindings still exist.
        for (const { local, imported } of helpers) {
          const binding = program.scope.getBinding(local);
          if (!binding) throw new Error(`No binding for the generated helper ${local}`);
          for (const ref of binding.referencePaths) {
            ref.replaceWith(t.memberExpression(t.identifier(HELPERS), t.identifier(imported)));
          }
        }
        for (const path of helperImports) path.remove();
        program.unshiftContainer(
          'body',
          t.importDeclaration([t.importNamespaceSpecifier(t.identifier(HELPERS))], t.stringLiteral(RUNTIME)),
        );
      },
    },
    post() {
      if (this.supportRewrites === 0) {
        throw new Error(`Expected tui.tsx to import ${SUPPORT_FROM}`);
      }
    },
  };
}

const code = await readFile(source, 'utf8');
const compiled = await transformAsync(code, {
  filename: source,
  configFile: false,
  babelrc: false,
  sourceMaps: false,
  presets: [
    ['babel-preset-solid', { moduleName: RUNTIME, generate: 'universal' }],
    '@babel/preset-typescript',
  ],
});
if (!compiled?.code) {
  throw new Error(`Babel produced no output for ${source}`);
}

const rewritten = await transformAsync(compiled.code, {
  filename: output,
  configFile: false,
  babelrc: false,
  sourceMaps: false,
  sourceType: 'module',
  plugins: [rewriteImports],
});
if (!rewritten?.code) {
  throw new Error(`Babel produced no output for the import rewrite of ${source}`);
}

const banner = '// Generated from src/tui.tsx by scripts/build-tui.mjs. Do not edit.\n';
await mkdir(dirname(output), { recursive: true });
await writeFile(output, banner + rewritten.code + '\n');
console.log(`built ${output}`);
