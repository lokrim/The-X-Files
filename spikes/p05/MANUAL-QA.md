# P05 manual acceptance on a physical Android phone

Use the accepted S23 or record the actual physical reference you used. Use only synthetic fixtures, a dedicated test directory, and a local sharing recipient. Record the device model, Android API, date, available RAM/storage, build revision or APK SHA-256, and whether USB was attached. Mark each row **Pass**, **Fail**, or **Not measured**. A missing optional provider or Android version stays **Not measured**. A regression in a required path keeps P05 open. D-66 already closed P01b.

## 1. Build, install, and open the benchmark

- [ ] Enable Developer options and USB debugging, authorize the host, and connect exactly one phone. Confirm status `device` with `adb devices -l`. A simulator run is a pre-check.
- [ ] From the repository root with the pinned Node version, run the host gates. Build before starting the benchmark launcher. The APK paths below are the normal local artifacts.

  ```sh
  EXPO_OFFLINE=1 npm run check
  npx tsc --project spikes/p05/tsconfig.json --noEmit
  EXPO_OFFLINE=1 ./android/gradlew -p android --offline -PreactNativeArchitectures=arm64-v8a \
    :app:assembleDebug :app:assembleRelease :app:bundleRelease
  npm run check:native
  adb install -r android/app/build/outputs/apk/debug/app-debug.apk
  adb reverse tcp:8081 tcp:8081
  XFILES_P05_BENCH=1 node spikes/p05/launch.cjs
  ```

  If Gradle reports uncached dependency artifacts, retry the build without Gradle's `--offline` when the host has access to the configured dependency repositories. Use the device ABI reported by `adb shell getprop ro.product.cpu.abi` on a reference that differs from the ARM64 S23. Check the APK signatures before resolving an install-signature mismatch. Keep any existing installation or user data until it is safe to replace it.

- [ ] Open X-Files in the dev launcher and load `http://127.0.0.1:8081` via USB. If another Metro instance owns port 8081, stop it or set `XFILES_P05_PORT=18081` and use the same port in the reverse mapping and URL. Expected screen title is **P05 device benchmark · synthetic data only**. The harness uses the production Android bridge and foreground service. The status and **Cancel file job** stay at the top as you scroll. Its entry/config overrides are temporary. Stop the launcher before rebuilding or editing those two files. After an abnormal exit, use `node spikes/p05/launch.cjs --restore` from the repo root once the launcher is stopped.
- [ ] Create two or more writable folders inside a dedicated directory under Downloads, one for originals and at least one for outputs. Use **Choose empty test folder** each time you switch destination. Keep a fresh folder for destructive fixture tests. Allow roughly 8 GB free for a 2 GB source, ciphertext, recovered copy, and room for temporary allocations. Allow more if you keep repeated copies or bundles.
- [ ] Prepare 1,024-byte, 50,000,000-byte, 500,000,000-byte, and 2,000,000,003-byte files. Use separate small files for a bundle. The following creates deterministic, non-secret fixtures whose chunks carry a sequence number. It writes only to a new host temp directory.

  ```sh
  export P05_FIXTURES="$(mktemp -d)"
  python3 - "$P05_FIXTURES" <<'PY'
  import pathlib, sys
  root = pathlib.Path(sys.argv[1])
  block = bytearray((bytes(range(251)) * 4178)[:2**20])
  for label, size in (("1k", 1024), ("50m", 50_000_000),
                      ("500m", 500_000_000), ("2g", 2_000_000_003)):
      with (root / f"p05-{label}.bin").open("xb") as out:
          for index, offset in enumerate(range(0, size, len(block))):
              block[:8] = index.to_bytes(8, "big")
              out.write(memoryview(block)[:min(len(block), size - offset)])
  PY
  export P05_DEVICE_DIR="/sdcard/Download/XFiles-P05-$(date +%Y%m%d-%H%M%S)"
  adb shell mkdir -p "$P05_DEVICE_DIR/input" "$P05_DEVICE_DIR/output"
  adb push "$P05_FIXTURES/p05-1k.bin" "$P05_FIXTURES/p05-50m.bin" \
    "$P05_FIXTURES/p05-500m.bin" "$P05_FIXTURES/p05-2g.bin" "$P05_DEVICE_DIR/input/"
  ```

- [ ] Pick fixtures through Android's actual picker. On devices where Downloads omits files pushed by ADB, index just the synthetic files with `adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/<test-directory>/input/<fixture>` and reopen the picker. For the destination choose the synthetic subfolder. If the tree picker omits the Downloads shortcut, open the phone's internal storage and navigate into `Download`, then into the synthetic `output` folder. Cancel the source and destination pickers separately and confirm neither action creates a file or starts a service. In a fresh benchmark session the encrypt control stays disabled until both selections exist.
- [ ] Capture aggregate harness events after each trial with `adb logcat -d -s ReactNativeJS:I | rg 'XFILES_P05'`, or use the Metro console. Use timestamps to separate runs. For locked trials, stop live log streaming and other polling before the quiet interval. Save only result codes, times, byte counts, booleans and aggregate memory. Keep file names, document URIs, fixture digests, clipboard contents and raw provider exceptions out of shared evidence.

## 2. Crypto on the phone

- [ ] Tap **AEAD · Node/NIST and throughput**. Expect `AEAD_RATE` and `AEAD_PASS`. Node and NIST byte comparisons, exact 16-byte tags, and tampered AAD/tag/ciphertext rejection all have to pass. Record seal/open rates in decimal MB/s. Both must be at least 15 MB/s. Record the foreground frame sample and whether the app remained responsive.
- [ ] Tap **KDF · RFC and production parity**. Expect `RFC_PASS` and one `KDF_PARITY_PASS` each for `log2N` 17 and 18, followed by `KDF_PASS`. The stored production answers are the independent Node/noble parity references for the same inputs. Record elapsed times and foreground frame samples. Default `N=2^17` must complete in at most 8 s. Record reader `N=2^18` timing separately.
- [ ] Tap **KDF · measure cancel and late wipe**. Expect pre-start pass and three `KDF_CANCEL_TRIAL_PASS` events across early, mid, and late timing. The harness calibrates against the phone, then retries if a timed abort loses the completion race. A `KDF_CANCEL_MISSED` alone earns no credit. Record actual abort delay, `callerMs`, `cpuStopUpperBoundMs` and `wiped`. Caller return measures when the awaiting JS resumes. Callback arrival is a conservative upper bound on native CPU completion. Confirm no result becomes available after an accepted cancel. Run parity again afterward to confirm recovery.
- [ ] In separate runs press **KDF memory · N=2^17** and **KDF memory · N=2^18**. From another terminal capture an idle baseline and samples during each run using `adb shell dumpsys meminfo -d com.xfiles.app`. Keep the native heap, total PSS/RSS and sampling interval per cost. Each button runs 12 serial derivations so polling can observe the native allocations. The 128/256 MiB algorithm tables are separate from measured overall memory. Label these sampled peaks. If you use a profiler for finer measurements, record it and repeat timings with the profiler detached.

## 3. Streaming, SAF, integrity, and capacity

- [ ] Run **Pick synthetic source → Hash source → Encrypt selected files → Decrypt or extract saved file → Verify recovered hashes** on 1 KB, 50 MB, 500 MB and the 2,000,000,003-byte input. Use the raw-key setting for sizing and throughput. Confirm `HASH_PARITY` contains the exact byte count and `match:true`. Compare full bytes independently if desired with `cmp -s` on the pulled synthetic input and recovered file. Record `ENCRYPT_RATE`, `DECRYPT_RATE`, foreground frame gaps and minimum progress gaps. Progress callbacks must be at least 100 ms apart where multiple callbacks arrive.
- [ ] On the 500 MB and 2 GB runs, sample idle and peak process PSS/RSS, native heap and Java heap separately. Save JS heap information from the debugger/profiler separately if available, from a different run than the quiet lock test. Use idle-to-peak process PSS growth below 150 MiB at 500 MB as the target and check that memory does not scale proportionally at 2 GB. Distinguish the raw-key pipeline sample from the scrypt samples. For no-copy evidence, compare `adb shell run-as com.xfiles.app du -sk cache` and the presence/size of cache subdirectories before, during and after a single-file run. A small unrelated development cache is plausible. There must be no source-sized copy. Check output appears in the chosen folder as direct SAF writes proceed.
- [ ] Switch **Next encryption · password**, repeat a small full pipeline, and record the same successful hash parity. Run **Try wrong credential** on both raw and password containers with a fresh destination. Expect `AUTH_FAILED` and zero new output. If the wrapper returns success or leaves an output, mark this case failed.
- [ ] Copy a synthetic ciphertext to two scratch fixtures. Flip one byte in its middle, and independently truncate several bytes off another copy. Pick each through **Pick alternate ciphertext for tamper tests**, then decrypt with the original fixture's correct credential. Expect `AUTH_FAILED` or `TRUNCATED` for the relevant variant, no successful result, and no new file left once cleanup is confirmed. Before running a valid trial again, tap **Use original ciphertext**. Only edit the scratch copies. A partially authenticated prefix may briefly be visible during the test.
      For a small ciphertext currently named `p05-synthetic.xfile` in the example output folder, the following creates two disposable copies. Use the actual name shown by Android Files if SAF renamed the output.

  ```sh
  adb pull "$P05_DEVICE_DIR/output/p05-synthetic.xfile" "$P05_FIXTURES/original.xfile"
  python3 - "$P05_FIXTURES" <<'PY'
  import pathlib, sys
  root = pathlib.Path(sys.argv[1])
  original = (root / "original.xfile").read_bytes()
  assert 100 < len(original) <= 100_000_000
  tampered = bytearray(original)
  tampered[len(tampered) // 2] ^= 1
  for name, data in (("p05-tampered.xfile", tampered),
                     ("p05-truncated.xfile", original[:-9])):
      with (root / name).open("xb") as out:
          out.write(data)
  PY
  adb push "$P05_FIXTURES/p05-tampered.xfile" "$P05_FIXTURES/p05-truncated.xfile" \
    "$P05_DEVICE_DIR/input/"
  ```

  If the Downloads picker omits the scratch files after indexing, rename the scratch copies with a `.bin` extension and index them again. The alternate-ciphertext picker accepts both extensions and the reader checks the bytes.

- [ ] Pick at least two synthetic files with **Pick synthetic bundle sources**, encrypt, extract to a fresh folder, and tap **Verify recovered hashes**. Confirm exact entry count and matching full hashes for all entries. Cancel once during the bundle passes and once during extraction after multiple new outputs exist. Check the complete set of new outputs is removed, including earlier closed entries. Keep a pre-existing collision sentinel with the same synthetic name and verify its bytes survive both successful collision handling and failed/cancelled runs. Check `cache/xfiles-tmp` after success and cancellation with `run-as`. A standalone ZIP picked singly should round-trip as one opaque file.
- [ ] After selecting a synthetic source but before encryption, append bytes to that fixture using the host or device and retry without repicking. Expect `SOURCE_CHANGED` and no final output. Repeat after repicking to confirm correct recovery. For a bundle change during processing, mutate the second small fixture after the first pass and before its second read if the timing can be controlled. Record which phase observed the change.
- [ ] On a known, low-space removable test volume, select a fixture whose required output plus reserve exceeds free space. Expect `NO_SPACE` before output creation. On a supported provider with unavailable free-space reporting, expect the **Capacity unknown** confirmation before a normal write; cancel once and proceed once. Use the injected ENOSPC case below if a suitable space-limited test volume is unavailable. Injection demonstrates error handling, while actual volume and available-space behavior are separate observations. The host tests cover exact headroom and shared-volume arithmetic.
- [ ] Startup sweep probe. With the benchmark stopped and no job in progress, place only a disposable synthetic file in the app's private `cache/xfiles-tmp` using `adb shell run-as com.xfiles.app` on the debug build. Relaunch and confirm that file is removed before the first job. If you force-stop a bundle run, check private temp cleanup on relaunch separately from any external partial cleanup. File removal alone does not prove forensic erasure.

### Separate synthetic SAF provider

Use the optional physical SD/alternative provider if available. For deterministic faults use the existing separate test APK under `spikes/p01b/provider` with the P05 fault additions. It runs under its own UID and never ships in X-Files. It also supplies the **P05 local recipient** test target for synthetic file and text sharing. The benchmark's file-share actions use a fixture-specific MIME type to make the local recipient easy to find. The app still uses its production Android sharing adapter and real URI grants.

```sh
./android/gradlew -p spikes/p01b/provider --offline :app:assembleDebug
adb install -r spikes/p01b/provider/app/build/outputs/apk/debug/app-debug.apk
```

If Android's picker omits the synthetic provider, grant access from its separate test APK with `adb shell am broadcast -n com.xfiles.p01bprovider/.ControlReceiver -a com.xfiles.p01bprovider.GRANT`. Use **Use granted short-read fixture** and **Use granted test output folder** in place of the corresponding picker selections. This exercises real Android URI grants and provider I/O. Record the picker visibility separately and reissue the grant after force-stopping either test process.

- [ ] Pick **P01b short** from the synthetic provider as a source, with an internal output folder. Capture successful full hash parity of 65,553 bytes. This is a pipe which returns short reads. Also pick **P01b denied** and **P01b unsafe** if the picker exposes them. Expect provider or bounds rejection with no result; report the actual code. The SDK picker may reject one of those before it reaches the adapter.
- [ ] Select the short fixture and run `adb shell am broadcast -n com.xfiles.p01bprovider/.ControlReceiver -a com.xfiles.p01bprovider.REVOKE` before starting the next read, using an internal output folder. Confirm the read grant is gone from the provider status or subsequent open and the read fails cleanly. If the grant survives due to another grant path, clear that test condition and label the attempt invalid. Repick the fixture for subsequent cases.
- [ ] Select the synthetic provider root through **Choose empty test folder**. Run **SAF fault · full**, **SAF fault · closeFault**, **SAF fault · deleteDenied** and **SAF fault · slowWrite** separately. The disk-full injection must show `NO_SPACE` and no leftover from that invocation. The close/write fault should fail with `IO_ERROR` and rollback. The delete-denial run must show `CLEANUP_UNCONFIRMED` and `cleanupFailed:true`; an observable synthetic leftover is expected. For slow write, tap **Cancel file job** while `SAF_FAULT_WRITE` is visible. Record the caller return, service removal, and whether the cleanup was confirmed within the bounded wait or later. A stalled provider must never be reported as confirmed cleanup.
- [ ] After the test, clean the synthetic provider's own leftovers only. `adb shell am broadcast -n com.xfiles.p01bprovider/.ControlReceiver -a com.xfiles.p01bprovider.RESET` resets its generated output set. Use Android Files for the remaining synthetic fixtures in your dedicated directory. Record optional real SD/other-provider success, grant loss or unmount separately.

## 4. Foreground service, lock, and actual timeout

- [ ] With notifications allowed and the **File operations** channel enabled, pick the 500 MB or larger fixture and an internal destination. Tap **Paced foreground-service test**. It performs up to 420 native-paced iterations of actual file read, AES-GCM and SAF write. Confirm a generic ongoing progress notification with no fixture names or secrets. Check the lock-screen presentation and the `SECRET` visibility setting in the notification record if available.
- [ ] Run separate quiet trials for Home/background and actual screen lock. Start the job from the active app. Wait for initial progress, then press Home or lock with the device button. Verify the requested state. Leave it quiet for at least 330 s with no ADB polling, Metro activity, debugger, live log stream, memory sampling, or interaction. Afterward read the retained aggregate `SERVICE_PROGRESS` events. Confirm progress continues throughout the interval while `foreground:false`, including near the end, and that bytes increase. A final burst after wake or a notification that stays visible while JS stalls is a failure. Record start/end state, duration, progress deltas and the largest observed event gap.
- [ ] Let one paced job complete and cancel another. Verify notification and service disappear and the temporary SAF test output is removed in both cases. Confirm there are no stale jobs via `adb shell dumpsys activity services com.xfiles.app`. Repeat a short portion with notification permission denied and with the channel disabled. Record actual drawer/task-manager visibility and whether the service starts, progresses and removes its output. Restore your original notification settings.
- [ ] Test Android **Active apps → Stop** while a synthetic paced job is running, on hardware that exposes the action. Record process/service/notification state, possible partial output, and manual cleanup. The Activity Manager force-stop equivalent for the synthetic-test session is also useful for the process-death case. Test cancellation and process stop separately. Use Android's [user-stopping behavior](https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping) as the reference.
- [ ] Run the actual OS timeout test on an API 35+ phone. Prepare the benchmark with the source and destination set but no running service. The script below stores and restores the original timeout setting. It verifies the **effective** value before you start the service. Once it prompts, start the job from the foreground, press Home, then leave the phone untouched for at least 30 s. Check service and notification removal before opening the app again. Expect `SERVICE_TIMEOUT`, no timeout crash, and either a removed partial or explicitly unconfirmed cleanup. Check for stalled or failed termination if the phone reports a different reason. Save the original, effective test and restored values with the result. [Android timeout procedure](https://developer.android.com/develop/background-work/services/fgs/timeout)

  ```bash
  bash <<'SH'
  key=data_sync_fgs_timeout_duration
  stored() { adb shell device_config get activity_manager "$key" | tr -d '\r'; }
  effective() {
    adb shell dumpsys activity settings | tr -d '\r' |
      sed -n "s/.*$key=\([0-9][0-9]*\).*/\1/p" | head -n 1
  }
  before=$(stored)
  before_effective=$(effective)
  if ! [[ "$before" =~ ^(null|[0-9]+)$ && "$before_effective" =~ ^[0-9]+$ ]]; then
    echo "Read the original stored and effective settings before changing anything." >&2
    exit 1
  fi
  printf 'Original stored=%s effective_ms=%s\n' "$before" "$before_effective"
  restore() {
    if [ "$before" = null ]; then
      adb shell device_config delete activity_manager "$key" >/dev/null
    else
      adb shell device_config put activity_manager "$key" "$before"
    fi
    for _ in {1..30}; do
      [ "$(effective)" = "$before_effective" ] && break
      sleep 1
    done
    after=$(stored)
    after_effective=$(effective)
    printf 'Restored stored=%s effective_ms=%s\n' "$after" "$after_effective"
    if [ "$after" != "$before" ] || [ "$after_effective" != "$before_effective" ]; then
      echo "Restore unconfirmed. Reconnect and restore the original setting before continuing." >&2
      exit 1
    fi
  }
  trap restore EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  adb shell device_config put activity_manager "$key" 10000 || exit 1
  for _ in {1..30}; do
    [ "$(effective)" = 10000 ] && break
    sleep 1
  done
  if [ "$(effective)" != 10000 ]; then
    echo "Effective limit did not update. Do not start the test." >&2
    exit 1
  fi
  echo "Effective test limit 10000 ms. Start the paced job, press Home and wait quietly."
  echo "Check the job outcome, then press Enter here to restore the original setting."
  read -r _ </dev/tty
  SH
  ```

## 5. Privacy, sharing, export, and offline package

- [ ] Tap **Show privacy probes → Open privacy fixture**. Confirm the public protected label and input appear once focus is established. Try hardware screenshot, screen recording and Recents preview. The protected fixture must be absent from captures. Type a synthetic value, test notification shade, Home/lock, system text share and the picker. On return the input indication must say **Test input retained**. Close and reopen the fixture and confirm **Test input empty**. Use TalkBack if available to check the hidden subtree is not announced. P07/P08 own the final password, key, share, and decrypt screens and their result-leave confirmation.
- [ ] Copy the public fixture with **30s**, **60s**, and **off**. Check actual feedback and clipboard state using **Check clipboard state**. Test before/after each expiry, including keeping the app backgrounded past expiry and returning. The clip should clear when it still belongs to X-Files and clipboard access is restored. With **off**, check it is still present after 65 s unless the OS itself cleared it. Verify sensitive preview behavior on the OS if supported. As a separate trial, replace the clip from a local editor with **P05 clipboard replacement**, then wait past expiry and check that it survives. Repeat with the identical fixture text copied by the editor to verify a new owner is preserved. Clipboard expiry after process death is best effort.
- [ ] Run **Share ciphertext**, choose a local app, and verify the recipient can read the synthetic ciphertext. Dismiss one share sheet and verify later decrypt still works. Run **Share recovered plaintext** and **Save a copy of recovered plaintext**, cancel the explicit prompts once, and confirm no chooser/extra file. Accept once using only the synthetic file. Test **Save a copy of ciphertext** in a new output folder and compare its bytes to the original ciphertext using `cmp -s` locally. Equal bytes demonstrate a copy without re-encryption. Test system text share with the public fixture.
      On the Samsung S23, swipe horizontally across the bottom row of app labels until **More** appears. Open it and choose **P05 local recipient** for each file or text share.
- [ ] Stop the harness. Check root entry and Metro configuration were restored, keep APK/AAB evidence, and verify the actual merged manifests with `npm run check:native`. In the final artifacts, inspect both APKs using `aapt2 dump permissions` and `aapt2 dump xmltree --file AndroidManifest.xml`. Expect the private `FileJobService` with `dataSync` in debug and release, foreground and notification permissions, no `WAKE_LOCK`, and `INTERNET` limited to debug. The release APK must contain `assets/index.android.bundle`, and the AAB must contain `base/assets/index.android.bundle`. Retain the clean `npm run check` release graph evidence for exclusion of test/spike sources and OTA.
- [ ] Install the normal release APK after checking its signing identity. Enable airplane mode, turn Wi-Fi off, and launch it with Metro stopped. Confirm Home and Settings load. Exercise the Clipboard settings choices, restart and verify the chosen duration is persisted. Confirm the offline wording in Settings. The normal release build at P05 exposes Home and Settings; end-user encrypt/decrypt flow acceptance belongs to P07/P08/P09. Restore the device's previous connectivity state, then remove only this test's USB reverse mapping with `adb reverse --remove tcp:8081` or the alternate port you used. Delete only synthetic outputs and fixtures.

## 6. Record the outcome

| Gate                                             | Evidence to record                                                                                                                                            | Status |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P05 host, native builds, preview/release package | Test counts, artifact hashes, inspected service/type/permissions, actual embedded bundle and release graph                                                    |        |
| Physical AEAD and scrypt                         | Node/NIST and RFC/stored production parity, exact tags, MB/s, default and reader time, foreground frame samples, KDF peak samples and cancel/late wipe bounds |        |
| Physical pipeline and storage                    | Sizes, full hash parity, throughput, UI/cancel response, progress gaps, memory, no source cache copy, extraction cleanup, storage/provider cases              |        |
| Foreground and actual timeout                    | Quiet background/lock intervals, progress at endpoints and in between, notification states, termination and cleanup, effective timeout restored               |        |
| Privacy, share and offline smoke                 | Screenshot/recents, foreground hide/restore, clipboard scenarios, file grants/byte copy, airplane-mode Home/Settings                                          |        |

Update `docs/PROGRESS.md` with the measured outcomes and remaining unmeasured cases. Keep P05 unchecked if a required gate is failed or unmeasured. Record the exact scenario and reason code before retrying. The accepted P01b CRC result is a planning reference, not a new P05 measurement. D-53's CRC experiment is non-blocking. Full end-user secret lifecycle and >4 GiB ZIP64 interoperability remain part of the later flow/release QA.
