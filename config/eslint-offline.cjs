const path = require('node:path');
const { importViolation } = require('./boundaries.cjs');
const forbidden = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'sendBeacon',
  'downloadAsync',
  'uploadAsync',
  'createDownloadResumable',
  'createUploadTask',
  'downloadFileAsync',
  'downloadFile',
  'uploadFile',
  'download',
  'upload',
  'DownloadResumable',
  'UploadTask',
  'install',
]);
const globals = new Set([
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'crypto',
  'Buffer',
  'eval',
  'Function',
  'require',
]);
module.exports = {
  rules: {
    boundaries: {
      meta: {
        type: 'problem',
        schema: [],
        messages: { violation: '{{reason}}' },
      },
      create(context) {
        const root = context.cwd;
        const filename = context.filename;
        function report(node, reason) {
          context.report({ node, messageId: 'violation', data: { reason } });
        }
        function checkImport(node, value) {
          if (typeof value !== 'string')
            return report(node, 'App imports must be statically resolvable.');
          const reason = importViolation(value, filename, root);
          if (reason) report(node, reason);
        }
        return {
          ImportDeclaration(node) {
            checkImport(node.source, node.source.value);
            if (
              node.source.value === 'expo' &&
              (node.specifiers.length !== 1 ||
                node.specifiers[0].imported?.name !== 'requireNativeModule')
            )
              report(
                node,
                'Only the named Expo native module loader is approved.',
              );
            for (const item of node.specifiers) {
              if (
                node.source.value === 'react-native' &&
                item.type !== 'ImportSpecifier'
              )
                report(
                  item,
                  'React Native imports must name approved APIs; raw namespace/default bridges are prohibited.',
                );
              const name = item.imported?.name || item.imported?.value;
              if (
                forbidden.has(name) ||
                (node.source.value === 'react-native' &&
                  [
                    'NativeModules',
                    'TurboModuleRegistry',
                    'Linking',
                    'Networking',
                  ].includes(name))
              )
                report(
                  item,
                  'Network APIs/raw native bridges are prohibited, including renamed imports.',
                );
            }
          },
          ExportNamedDeclaration(node) {
            if (node.source) checkImport(node.source, node.source.value);
          },
          ExportAllDeclaration(node) {
            checkImport(node.source, node.source.value);
          },
          ImportExpression(node) {
            if (node.source.value === 'expo')
              report(node, 'Import the Expo native module loader by name.');
            checkImport(node.source, node.source.value);
          },
          'Program:exit'() {
            for (const scope of context.sourceCode.scopeManager.scopes) {
              for (const ref of scope.references) {
                if (
                  globals.has(ref.identifier.name) &&
                  (!ref.resolved || ref.resolved.defs.length === 0)
                )
                  report(
                    ref.identifier,
                    'Network globals, dynamic loaders and global crypto/Buffer shims are prohibited.',
                  );
              }
            }
          },
          MemberExpression(node) {
            const name = node.computed
              ? node.property.value
              : node.property.name;
            if (
              forbidden.has(name) ||
              (['globalThis', 'window', 'global'].includes(node.object.name) &&
                ['crypto', 'Buffer', ...globals].includes(name))
            )
              report(
                node,
                'Network calls and global crypto/Buffer shims are prohibited.',
              );
            if (
              node.object.name === 'Math' &&
              name === 'random' &&
              filename.includes(`${path.sep}core${path.sep}`)
            )
              report(
                node,
                'Core randomness must use the injected secure provider.',
              );
          },
          Property(node) {
            if (forbidden.has(node.key.name || node.key.value))
              report(node, 'Network API aliases/destructuring are prohibited.');
          },
          Literal(node) {
            if (
              typeof node.value === 'string' &&
              /^(?:https?|wss?|ftp):\/\//i.test(node.value)
            )
              report(
                node,
                'Remote URLs/assets are prohibited in application sources.',
              );
          },
        };
      },
    },
  },
};
