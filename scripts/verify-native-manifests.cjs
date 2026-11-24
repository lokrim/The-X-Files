// Run only after Gradle processDebugMainManifest/processReleaseMainManifest.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseStringPromise } = require('xml2js');
const { permissions, debugMetroPermissions } =
  require('../plugins/with-offline-android.cjs').policy;
const intermediates = path.resolve(
  __dirname,
  '../android/app/build/intermediates',
);
function walk(dir) {
  return fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .flatMap((entry) =>
          entry.isDirectory()
            ? walk(path.join(dir, entry.name))
            : [path.join(dir, entry.name)],
        )
    : [];
}
async function main() {
  const files = walk(intermediates);
  for (const [profile, variant] of [
    ['development', 'debug'],
    ['preview', 'release'],
    ['production', 'release'],
  ]) {
    const file = files.find(
      (file) =>
        file.includes(`/merged_manifests/${variant}/`) &&
        file.endsWith('/AndroidManifest.xml'),
    );
    assert(
      file,
      `Missing actual Gradle merged manifest for ${profile}; build required.`,
    );
    const manifest = (await parseStringPromise(fs.readFileSync(file, 'utf8')))
      .manifest;
    const names = (manifest['uses-permission'] || []).map(
      (entry) => entry.$['android:name'],
    );
    assert.equal(
      names.includes('android.permission.INTERNET'),
      variant === 'debug',
      `${profile} INTERNET policy`,
    );
    for (const name of permissions)
      assert(names.includes(name), `${profile}: ${name}`);
    const app = manifest.application[0];
    const jobServices = (app.service || []).filter((service) =>
      service.$['android:name'].startsWith('expo.modules.xfiles.'),
    );
    assert.equal(jobServices.length, 1, `${profile} production service count`);
    assert.equal(
      jobServices[0].$['android:name'],
      'expo.modules.xfiles.FileJobService',
    );
    assert.equal(jobServices[0].$['android:exported'], 'false');
    assert.equal(jobServices[0].$['android:foregroundServiceType'], 'dataSync');
    assert.equal(jobServices[0].$['android:stopWithTask'], 'false');
    assert(
      !(app.receiver || []).some((receiver) =>
        /p01b|p05|expo\.modules\.xfiles/i.test(receiver.$['android:name']),
      ),
      `${profile} contains a measurement receiver`,
    );
    assert(
      !names.includes('android.permission.WAKE_LOCK'),
      `${profile} WAKE_LOCK policy`,
    );
    assert.equal(app.$['android:allowBackup'], 'false');
    assert.equal(
      app.$['android:fullBackupContent'],
      '@xml/xfiles_backup_rules',
    );
    assert.equal(
      app.$['android:dataExtractionRules'],
      '@xml/xfiles_data_extraction_rules',
    );
    assert(
      !(app['meta-data'] || []).some((entry) =>
        entry.$['android:name'].startsWith('expo.modules.updates.'),
      ),
    );
    {
      const allowed = new Set([
        ...permissions,
        ...(variant === 'debug' ? debugMetroPermissions : []),
        'android.permission.VIBRATE',
        'android.permission.DETECT_SCREEN_CAPTURE',
        'com.xfiles.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION',
      ]);
      for (const name of names)
        assert(allowed.has(name), `Unexpected ${profile} permission: ${name}`);
    }
    console.log(
      `PASS: ${profile} actual ${variant} merge, permissions=${names.join(',')}`,
    );
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
