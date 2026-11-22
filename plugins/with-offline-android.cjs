const fs = require('node:fs/promises');
const path = require('node:path');
const {
  withAndroidManifest,
  withDangerousMod,
  withGradleProperties,
} = require('expo/config-plugins');

const permissions = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.POST_NOTIFICATIONS',
];
const removePermissions = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_WIFI_STATE',
  'android.permission.CHANGE_NETWORK_STATE',
  'android.permission.CHANGE_WIFI_STATE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_MEDIA_AUDIO',
  'android.permission.USE_BIOMETRIC',
  'android.permission.USE_FINGERPRINT',
];
const header =
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">';
const debugManifest = `${header}
  <uses-permission android:name="android.permission.INTERNET" />
  <application android:usesCleartextTraffic="true" tools:replace="android:usesCleartextTraffic" />
</manifest>\n`;
const releaseManifest = `${header}
${removePermissions.map((name) => `  <uses-permission android:name="${name}" tools:node="remove" />`).join('\n')}
  <application android:usesCleartextTraffic="false" tools:replace="android:usesCleartextTraffic" />
</manifest>\n`;
// Cache is excluded by Android already. Explicit paths also document the private
// temp contract for future file adapters; root exclusions cover device transfer.
const backupRules = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="." />
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
</full-backup-content>\n`;
const extractionRules = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
    <exclude domain="root" path="." /><exclude domain="file" path="." />
    <exclude domain="database" path="." /><exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." /><exclude domain="file" path="." />
    <exclude domain="database" path="." /><exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </device-transfer>
</data-extraction-rules>\n`;

function configureManifest(document) {
  const manifest = document.manifest;
  manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  manifest['uses-permission'] = (manifest['uses-permission'] || []).filter(
    (entry) => !removePermissions.includes(entry.$['android:name']),
  );
  for (const name of permissions) {
    if (
      !manifest['uses-permission'].some(
        (entry) => entry.$['android:name'] === name,
      )
    )
      manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
  const app = manifest.application[0];
  Object.assign(app.$, {
    'android:allowBackup': 'false',
    'android:fullBackupContent': '@xml/xfiles_backup_rules',
    'android:dataExtractionRules': '@xml/xfiles_data_extraction_rules',
    'android:usesCleartextTraffic': 'false',
    'tools:replace':
      'android:allowBackup,android:fullBackupContent,android:dataExtractionRules',
  });
  app['meta-data'] = (app['meta-data'] || []).filter(
    (entry) => !entry.$['android:name'].startsWith('expo.modules.updates.'),
  );
  return document;
}
async function writeVariantFiles(androidRoot) {
  const files = {
    'app/src/debug/AndroidManifest.xml': debugManifest,
    'app/src/debugOptimized/AndroidManifest.xml': debugManifest,
    'app/src/release/AndroidManifest.xml': releaseManifest,
    'app/src/main/res/xml/xfiles_backup_rules.xml': backupRules,
    'app/src/main/res/xml/xfiles_data_extraction_rules.xml': extractionRules,
  };
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(androidRoot, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }
}
function withOfflineAndroid(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults = configureManifest(mod.modResults);
    return mod;
  });
  config = withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter(
      (entry) => entry.key !== 'newArchEnabled',
    );
    mod.modResults.push({
      type: 'property',
      key: 'newArchEnabled',
      value: 'true',
    });
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      await writeVariantFiles(mod.modRequest.platformProjectRoot);
      return mod;
    },
  ]);
}
module.exports = withOfflineAndroid;
module.exports.policy = {
  permissions,
  removePermissions,
  configureManifest,
  writeVariantFiles,
};
