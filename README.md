# X-Files

An Android offline file-encryption app scaffold built with Expo SDK 58, React Native 0.88.1 and React 19.3.0. Home and persistent theme preferences are available; encryption and decryption are not implemented yet.

X-Files makes no network connections itself; apps you choose to save to or share with may.

## Development

Use Node 22.23.5 (see `.node-version`) and npm 10.9.9.

```sh
npm ci
npm run check
npm run doctor
npx expo run:android
```

The app requires a development client. To start Metro for an installed client:

```sh
npx expo start --dev-client
```

Native projects are generated from `app.json` and `plugins/`:

```sh
npx expo prebuild --platform android --no-install
```

Edit those configuration sources instead of generated native files. Development grants INTERNET for Metro; preview and production use release overlays that remove it and embed JavaScript/assets.

## Validation

`npm run check` verifies dependency compatibility, app/test TypeScript, lint, tests, import boundaries, build-profile generation and the actual production Metro graph/assets. `npm run doctor` checks the Expo environment. Exact dependencies and required native peers are pinned in `package-lock.json`; `.npmrc` omits unnecessary implicit peers.

An arm64 Android development APK has compiled, installed and loaded Metro; actual debug/release manifest policy checks also pass. Device feasibility validation remains incomplete, and encryption/decryption are still unavailable. After generating manifests on your build host, run `npm run check:native`; JavaScript/config checks and exported bundles alone do not certify native behavior or a release APK.
