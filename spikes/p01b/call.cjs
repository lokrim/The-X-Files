// Local development-tool transport only; never imported by app/Metro.
const action = process.argv[2];
if (
  ![
    'crypto',
    'aead',
    'nativeKdf',
    'kdf',
    'revoked',
    'large',
    'cancelOutput',
    'pickNative',
    'plainService',
    'disabledService',
    'cleanup',
    'faults',
    'service',
    'stopService',
    'serviceStatus',
    'cancel',
  ].includes(action)
)
  process.exit(2);
process.on('uncaughtException', () => {
  process.stderr.write('P01B_CONTROL_FAILED\n');
  process.exit(1);
});
let stage = 'TARGETS';
(async () => {
  const targets = await (await fetch('http://127.0.0.1:8081/json/list')).json();
  const target = targets.find((t) => t.appId === 'com.xfiles.app');
  if (!target) throw new Error('TARGET_MISSING');
  stage = 'WEBSOCKET_MODULE';
  const WebSocket = require('ws');
  const ws = new WebSocket(target.webSocketDebuggerUrl, {
    origin: 'http://127.0.0.1:8081',
  });
  stage = 'WEBSOCKET_CONNECT';
  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('CONTROL_TIMEOUT')),
      10000,
    );
    ws.addEventListener('open', () =>
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: {
            expression: `if(typeof globalThis.__P01b?.${action}!=='function')throw Error('P01B_NOT_READY');globalThis.__P01b.${action}(); 'requested'`,
            returnByValue: true,
          },
        }),
      ),
    );
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === 1) {
        clearTimeout(timeout);
        resolve(!message.error && !message.result?.exceptionDetails);
      }
    });
    ws.addEventListener('error', reject);
  });
  ws.close();
  process.stdout.write(JSON.stringify({ action, requested: result }) + '\n');
})().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      reason: 'P01B_CONTROL_FAILED',
      stage,
      code: [
        'MODULE_NOT_FOUND',
        'ECONNREFUSED',
        'ERR_INVALID_ARG_TYPE',
      ].includes(error?.code)
        ? error.code
        : null,
    }) + '\n',
  );
  process.exit(1);
});
