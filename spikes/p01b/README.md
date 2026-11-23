# P01b development instrumentation

Not an application feature or a passed gate. Normal app imports/compiler/Metro exclude this directory. The launcher requires `XFILES_P01B=1`, temporarily changes the package entry and Metro config, and backs up/restores those files plus tsconfig (which Expo may update) on exit. Never build a release while it is active. If killed without exit handlers, run `node spikes/p01b/launch.cjs --restore` before any application build/check.

Run a development client with `XFILES_P01B=1 node spikes/p01b/launch.cjs` and USB `adb reverse tcp:8081 tcp:8081`. Typecheck separately with `npx tsc -p spikes/p01b/tsconfig.json --noEmit`. The launcher also temporarily selects `./spikes/p01b/native` for Expo native autolinking; rebuild/install the **debug** client while it is active to enable the measurement module. SDK candidates are pinned by the root lockfile. All crypto, I/O and service implementations here are disposable candidates, never production adapters.

This harness measures two sequential, awaited 1 MiB SDK reads from a >=2 GB no-copy picker URI, including reopening, short terminal reads, byte counts, aggregate cache snapshots and available Hermes heap stats. Throughput includes yields/instrumentation. Direct output uses a newly SAF-created file in write-only mode; raw write timing excludes hashing. It counts a bounded read-back and separately compares SDK native streaming SHA-256 against the independent Node synthetic-data reference under test-utils, without logging a digest, then deletes the test output. Regenerate that public reference with `node test-utils/p01b/write-reference.mjs`. SDK native digest was source-inspected to stream 64 KiB, without caching/read-all. Cancellation deletes only the newly created output. Provider-specific capacity is explicitly unknown. CRC timing sums CPU-loop wall intervals excluding yields and reports separate total wall time and a two-pass decimal 2 GB CPU estimate.

`crypto.ts` compares Quick Crypto and expo-crypto against public Node/NIST AES-GCM answers, then noble and async native scrypt against RFC7914/Node answers. References and small-cost helpers stay in test-utils. It never installs global shims. Native scrypt deliberately uses 384 MiB maxmem; cancellation discards/wipes late results and waits separately for the native callback. The original collected cancel response measured two timestamps inside the abort handler and **does not establish caller-resume latency**. Use the corrected `KDF_CALLER_CANCEL_RESPONSE` events after the waiting caller resumes. Callback arrival bounds CPU completion from above; it is not an exact native CPU-stop timestamp. Actual measurements belong in DECISIONS/PROGRESS.

The offline synthetic DocumentsProvider in `provider/` supplies non-seekable short reads, grant revocation and controlled output faults. Install its separate debug APK, start the target app, and **grant access after every force-stop/restart**, before invoking `faults` or `large`:

```sh
adb shell am broadcast -f 0x20 -a com.xfiles.p01bprovider.GRANT -n com.xfiles.p01bprovider/.ControlReceiver
node spikes/p01b/call.cjs faults
adb shell am broadcast -f 0x20 -a com.xfiles.p01bprovider.REVOKE -n com.xfiles.p01bprovider/.ControlReceiver
node spikes/p01b/call.cjs revoked
```

The separate provider declares a visibility query for only the fixed target package. Verify both provider-side and target-side grants before attributing an open/read failure to the SDK. Earlier unclassified failures did not establish ESPIPE; current instrumentation reports that category only when the SDK error contains an illegal-seek marker and access was confirmed. Native errors retain allowlisted query/open/read stages; never print raw errors/URIs. Cases run independently. `large` applies bounded 2 GB read/reopen/write/count/digest/delete with native/RSS/Hermes memory sampling; `pickNative` uses a real no-copy DocumentPicker URI; `cancelOutput` measures new-output partial cleanup. Unknown destination capacity warns. The simulated full-provider fault does not actually exhaust the phone filesystem.

The service candidate is now **measurement module0.2.0 / diagnostics schema2**. It retains the same ReactContext and HeadlessJS runtime. The default record loop awaits a native coroutine instead of a React Native JS timer. This is a measurement candidate, not a general wake guarantee: native delays/HandlerThread callbacks also stop when the CPU suspends. No wake-lock permission, new dependency or extra JS runtime is introduced.

`service-loop.ts` fences every work/progress/wait/stop call by generation and checks again after native I/O. A late completion cannot write for or stop a replacement job. Native cancellation wakes pending coroutine waits; file cleanup runs separately from the main/timeout thread and waits for an in-flight write to close. Every JS loop exit requests native stop for its owning generation, including a normal bounded-work exit; a stale completion cannot stop a replacement job, and stop failure still wipes the owned chunk. The native diagnostic heartbeat advances only its own counters, never the JS sequence or work-byte counter. Clock deltas, task/activity lifecycle and power/keyguard state distinguish suspend observations from scheduling stalls; they do not prove a unique cause. A native watchdog checks the ten-minute cap, including when JS is stalled; it cannot wake a suspended CPU. Writes stop before exceeding the2 GB synthetic-work cap.

| Host control action | Scheduler | Intended use |
|---|---|---|
| `plainService` | JS timer200 ms, no headless task | Short foreground-service-only baseline |
| `timerService` | JS timer200 ms, headless task | Reproduce/compare the old scheduling path with the same new probes |
| `service` / UI “Start dataSync service” | Native coroutine200 ms | Main candidate for330 s background/lock trials |
| `slowService` | Native coroutine1,000 ms | Slow/idle-wait candidate for330 s trials |
| `steadyService` | Native yield, no deliberate wait | Short control only;2 GB cap can end it early, never five-minute acceptance evidence |

Compile without a phone or Metro (requires the generated Android project and cached toolchain/dependencies):

```sh
NODE_ENV=development EXPO_OFFLINE=1 XFILES_P01B=1 node spikes/p01b/launch.cjs --native-check
npx tsc -p spikes/p01b/tsconfig.json --noEmit
npx tsc -p spikes/p01b/tsconfig.tests.json --noEmit
npx jest --config spikes/p01b/jest.config.cjs --runInBand
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s spikes/p01b/__tests__ -p 'test_*.py'
```

`--native-check` runs only arm64 `assembleDebug --offline` and restores wiring when it exits, including on build failure; set `XFILES_P01B_GRADLE` to an existing verified Gradle executable if the wrapper cache is unavailable. It does not start a server, install an app, run adb or produce physical-phone measurements. Unit tests cover late-result/cancel/restart behavior and evidence/cleanup logic; mocked healthy samples are not device proof.

For a physical rerun, enable Developer options/USB debugging, connect/authorize a data cable, and verify `adb devices` lists the physical phone as `device`. Start the development launcher normally, run `npx expo run:android` to rebuild/install the matching schema2 client and select the phone, then configure USB forwarding above. The previous normal release app has no measurement module. Before each comparison stop/verify cleanup, then use a fresh app process and bring the harness to the foreground. Preserve notification/timeout settings; enable notifications/the test channel for the positive privacy window. Never reuse an evidence output filename.

```sh
# Foreground app; run one profile per fresh process. Locked trials leave the phone locked.
node spikes/p01b/call.cjs timerService
python3 spikes/p01b/service-watch.py locked .artifacts/p01b/timer-v2-lock-01.json --scheduler js-timer
# After cleanup/restart and returning to the foreground:
node spikes/p01b/call.cjs service
python3 spikes/p01b/service-watch.py locked .artifacts/p01b/native-v2-lock-01.json --scheduler native-paced
# Repeat candidate with mode background, then slowService/native-slow with locked/background.
```

The runner requires one unambiguous physical phone and a development build; it correlates snapshots and cleanup with the process instance plus generation. Before silence it verifies the background transition, tries idempotent SLEEP, permits one POWER fallback only after a fresh awake/background snapshot, and allows up to45 seconds for delayed keyguard activation. The full quiet interval starts only after the requested state is confirmed, announced by the host-only `QUIET_WINDOW_STARTED` event. It performs **no adb/debugger/progress polling during the entire quiet interval**, captures native state first afterward, and attempts stop/cleanup for the owned generation in finally. Both terminal age and maximum JS gap must be <=5,000 ms (explicit harness threshold), real JS sequence/byte progress and private ongoing notification must exist, and lock/background/lifetime evidence must match. Old/missing diagnostics never pass. Native counters alone cannot pass. Native clocks and heartbeat help diagnose a failure even if JS resumes when the endpoint command wakes the phone. Outputs distinguish PASS/FAIL/INCOMPLETE/CONTROL; a window pass is not overall P01b acceptance.

For the25 s OS timeout check, stop any existing test service and leave the harness visible, then run `PYTHONDONTWRITEBYTECODE=1 python3 spikes/p01b/service-timeout.py .artifacts/p01b/timeout-v2-01.json`. Do not start a service first. This outer runner captures the stored/effective limits, applies and verifies10,000 ms before the actual foreground test-button start, invokes the quiet observer, and restores both limits in finally. It also stops only its known owned generation. Setting the property after creation did not reproduce the callback on this phone. The inner observer alone is not the recommended setup. If disconnected, cleanup/restore stay unconfirmed; the sibling `.restore.json` preserves the original settings for recovery. Recheck notification denial, actual user-disabled channel (programmatic NONE may become LOW), cancel/success, pending-wait/restart races and force-stop partial cleanup. Service behavior and all new phone results stay unmeasured until these trials run. Results and the stop rule are in DECISIONS/PROGRESS; never promote the measurement service or silently add permissions/runtime.

`memory.py` records aggregate dumpsys baselines/sampled peaks (no raw dumps); create the matching `.stop` file to finish it. `device.py` navigates known labels only, avoiding unrelated UI text/filename logs; Android picker navigation may require the phone user's help. `call.cjs` is host-only CDP control; `collect.py` extracts only this app's allowlisted aggregate events from adb. Neither belongs in app code. Results, limitations and the remaining fix plan are in DECISIONS/PROGRESS. Android17 debug results do not supply Android14/15 or identified mid-range reference coverage.

After every run, stop the test service with `adb shell am broadcast -a com.xfiles.P01B_STOP -n com.xfiles.app/expo.modules.p01b.P01bStatusReceiver`, verify cleanup, remove only task-owned synthetic fixtures, reset/uninstall `com.xfiles.p01bprovider`, delete test channels, and remove USB forwarding. Restore captured notification permission/device_config. Restore launcher wiring, rebuild/install the normal app to remove debug test hooks, and verify release graph/native autolinking. Actual cleanup evidence belongs in PROGRESS; never infer it from these instructions.
