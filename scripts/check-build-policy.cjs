const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseStringPromise } = require('xml2js');
const semver = require('semver');
const app = require('../app.json').expo;
const eas = require('../eas.json');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
const fsSync = require('node:fs');
const { policy } = require('../plugins/with-offline-android.cjs');

async function main() {
  assert(
    fsSync
      .readFileSync(require.resolve('../.npmrc'), 'utf8')
      .includes('omit=peer'),
  );
  assert(
    !fsSync.existsSync(
      require
        .resolve('../package.json')
        .replace('package.json', 'node_modules/react-server-dom-webpack'),
    ),
    'Unneeded server peer must remain omitted from the installed graph.',
  );
  assert.equal(pkg.main, 'expo-router/entry');
  assert.equal(app.name, 'X-Files');
  assert.equal(app.android.package, 'com.xfiles.app');
  assert.equal(app.userInterfaceStyle, 'automatic');
  assert.equal(app.updates.enabled, false);
  assert(!app.runtimeVersion && !app.updates.url);
  assert(
    !app.android.blockedPermissions?.includes('android.permission.INTERNET'),
  );
  assert.equal(app.android.allowBackup, false);
  assert(semver.satisfies(process.version, pkg.engines.node));
  assert(semver.satisfies(pkg.dependencies.expo, '58.x'));
  assert(semver.satisfies(pkg.dependencies['react-native'], '0.88.x'));
  assert(semver.satisfies(pkg.dependencies.react, '19.x'));
  assert(semver.satisfies(pkg.dependencies['react-native-reanimated'], '4.x'));
  assert(semver.gte(pkg.dependencies['react-native-nitro-modules'], '0.31.2'));
  assert(semver.gte(pkg.dependencies['react-native-quick-base64'], '3.0.0'));
  for (const [name, version] of Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
  })) {
    assert(semver.valid(version), `${name} must use an exact version`);
    assert.equal(
      lock.packages[`node_modules/${name}`].version,
      version,
      `${name} lock mismatch`,
    );
    assert.equal(
      lock.packages[''][
        pkg.dependencies[name] ? 'dependencies' : 'devDependencies'
      ][name],
      version,
    );
  }
  for (const name of Object.keys(pkg.dependencies))
    assert(
      !/^(expo-updates|expo-notifications|@notifee\/|@sentry\/|firebase|@react-native-firebase\/|axios|fflate|jszip|pako|react-native-background-actions)/.test(
        name,
      ),
      `Unauthorized runtime package: ${name}`,
    );
  assert.equal(eas.build.development.developmentClient, true);
  assert.equal(
    eas.build.development.android.gradleCommand,
    ':app:assembleDebug',
  );
  assert.equal(eas.build.preview.android.gradleCommand, ':app:assembleRelease');
  assert.equal(
    eas.build.production.android.gradleCommand,
    ':app:bundleRelease',
  );
  assert(
    !eas.build.preview.developmentClient &&
      !eas.build.production.developmentClient,
  );
  // Execute the actual plugin generator twice and parse its generated XML.
  // This is generation/config evidence; Android's real merger is checked separately.
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'xfiles-policy-'));
  try {
    await policy.writeVariantFiles(temp);
    await policy.writeVariantFiles(temp);
    const fixture = {
      manifest: {
        $: {},
        'uses-permission': [
          { $: { 'android:name': 'android.permission.INTERNET' } },
        ],
        application: [
          {
            $: {},
            'meta-data': [
              { $: { 'android:name': 'expo.modules.updates.ENABLED' } },
            ],
          },
        ],
      },
    };
    const main = policy.configureManifest(fixture).manifest;
    assert(
      !main['uses-permission'].some(
        (entry) => entry.$['android:name'] === 'android.permission.INTERNET',
      ),
    );
    assert.equal(main.application[0].$['android:allowBackup'], 'false');
    assert.equal(main.application[0]['meta-data'].length, 0);
    for (const name of policy.permissions)
      assert(
        main['uses-permission'].some(
          (entry) => entry.$['android:name'] === name,
        ),
      );
    for (const variant of ['debug', 'debugOptimized', 'release']) {
      const doc = await parseStringPromise(
        await fs.readFile(
          path.join(temp, `app/src/${variant}/AndroidManifest.xml`),
          'utf8',
        ),
      );
      const internet = doc.manifest['uses-permission'].find(
        (entry) => entry.$['android:name'] === 'android.permission.INTERNET',
      );
      assert.equal(
        internet.$['tools:node'],
        variant === 'release' ? 'remove' : undefined,
      );
      assert.equal(
        doc.manifest.application[0].$['android:usesCleartextTraffic'],
        variant === 'release' ? 'false' : 'true',
      );
    }
    const extraction = await parseStringPromise(
      await fs.readFile(
        path.join(
          temp,
          'app/src/main/res/xml/xfiles_data_extraction_rules.xml',
        ),
        'utf8',
      ),
    );
    for (const scope of ['cloud-backup', 'device-transfer'])
      assert(
        extraction['data-extraction-rules'][scope][0].exclude.some(
          (entry) => entry.$.domain === 'root' && entry.$.path === '.',
        ),
      );
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  console.log(
    'PASS: pinned engine/lock/peers, build-profile mapping and executed variant/backup generator. Native merge/APK evidence is separate.',
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
