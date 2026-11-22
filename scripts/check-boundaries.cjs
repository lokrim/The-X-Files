const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { ESLint } = require('eslint');
const { isExcluded, importViolation } = require('../config/boundaries.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const config = ts.readConfigFile(
    path.join(root, 'tsconfig.json'),
    ts.sys.readFile,
  );
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  for (const source of program.getSourceFiles()) {
    const name = fs.realpathSync(source.fileName);
    if (name.includes(`${path.sep}node_modules${path.sep}`)) continue;
    assert(!isExcluded(name), `Excluded helper compiled into app: ${name}`);
    if (!name.endsWith('.d.ts')) {
      function visit(node) {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const specifier = node.moduleSpecifier.text;
          assert(
            !importViolation(specifier, name, root),
            `${name}: ${specifier}`,
          );
          const resolved = ts.resolveModuleName(
            specifier,
            name,
            parsed.options,
            ts.sys,
          ).resolvedModule;
          if (resolved && !resolved.isExternalLibraryImport)
            assert(
              !isExcluded(fs.realpathSync(resolved.resolvedFileName)),
              `Resolved/symlinked test helper: ${specifier}`,
            );
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  // Mutation probes exercise the active ESLint configuration, including aliases.
  const eslint = new ESLint({ cwd: root });
  const bad = [
    "import { downloadAsync as localCopy } from 'expo-file-system'; void localCopy;",
    "import * as FS from 'expo-file-system'; const f = FS.File.downloadFileAsync; void f;",
    "import * as FS from 'expo-file-system'; const { uploadAsync: save } = FS; void save;",
    "import { get as localGet } from 'axios'; void localGet;",
    'const local = fetch; void local;',
    "const local = globalThis['WebSocket']; void local;",
    "import value from '@/../test-utils/helper'; void value;",
    "import('@noble/hashes/scrypt');",
    "require('node:http');",
    'globalThis.Buffer = null;',
    "import('expo/fetch');",
    "import { getItemAsync as read } from 'expo-secure-store'; void read;",
    "import * as RN from 'react-native'; const n = RN.NativeModules; void n;",
    "import { NativeModules as bridge } from 'react-native'; void bridge;",
    "import { persist as save } from 'zustand/middleware'; void save;",
    "import { install as setup } from 'react-native-quick-crypto'; setup();",
  ];
  for (const code of bad) {
    const [result] = await eslint.lintText(code, {
      filePath: path.join(root, 'src/features/boundary-probe.ts'),
    });
    assert(
      result.messages.some(
        (message) => message.ruleId === 'offline/boundaries',
      ),
      `Boundary probe incorrectly accepted: ${code}`,
    );
  }
  const [core] = await eslint.lintText(
    "import { scryptAsync } from '@noble/hashes/scrypt.js'; void scryptAsync;",
    { filePath: path.join(root, 'src/core/probe.ts') },
  );
  assert(
    core.messages.some((message) => message.ruleId === 'offline/boundaries'),
  );
  const [local] = await eslint.lintText(
    "import { File } from 'expo-file-system'; import { shareAsync as share } from 'expo-sharing'; void File; void share;",
    { filePath: path.join(root, 'src/platform/probe.ts') },
  );
  assert.equal(local.errorCount, 0, JSON.stringify(local.messages));
  console.log(
    `PASS: actual app TypeScript graph and ${bad.length + 2} boundary mutation/allow probes.`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
