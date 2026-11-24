# P06 component gallery

Use the X-Files Android development build. The gallery has a separate Metro configuration and a standalone entry under `spikes/`. It has no Router route. The ordinary Metro resolver rejects this directory, and the production export inspects bundled modules and assets for excluded paths.

From the project root, with the regular Metro server stopped or on another port:

```sh
EXPO_OVERRIDE_METRO_CONFIG="$PWD/spikes/p06/metro.cjs" EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 \
  npx expo start --dev-client --localhost --port 8096
```

Forward `tcp:8096` with ADB, then open the development URL printed by Expo on Android. Use only public fixtures in the password field. The gallery does not write settings. Its copy action uses the normal native clipboard adapter and the app's in-memory default expiry.

At 360 dp and again at a larger width, verify both themes. Increase Android's font size and enable TalkBack. Check control names, checked and disabled states, dialog Back and focus, and the reading order. Toggle Android's Remove animations setting to compare toast and dialog entry.

With blocking on, verify the window has `FLAG_SECURE` and captures do not show app content. Reveal the fixture, then open Home or the notification shade and return. The fixture should be hidden and the input draft should still be available through the masked field. With blocking off, the app can be captured, and blur still resets reveal state. The countdown and copy feedback should contain no fixture text.
