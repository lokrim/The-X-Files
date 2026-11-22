"""Aggregate-only development adb memory sampler; never stores raw dumps."""
import argparse
import json
import pathlib
import re
import subprocess
import time

parser = argparse.ArgumentParser()
parser.add_argument("output")
parser.add_argument("--seconds", type=int, default=600)
args = parser.parse_args()
output = pathlib.Path(args.output)
stop = output.with_suffix(".stop")
stop.unlink(missing_ok=True)
baseline = None
peak = {}
samples = 0
failed = 0
started = time.monotonic()
while time.monotonic() - started < args.seconds and not stop.exists():
    try:
        raw = subprocess.run(["adb", "shell", "dumpsys", "meminfo", "com.xfiles.app"], capture_output=True, text=True, timeout=5, check=True).stdout
        sample = {}
        for name, pattern in {
            "totalPssKiB": r"TOTAL PSS:\s+(\d+)",
            "totalRssKiB": r"TOTAL RSS:\s+(\d+)",
            "nativeHeapPssKiB": r"^\s*Native Heap\s+(\d+)",
            "nativeHeapAllocatedKiB": r"^\s*Native Heap\s+(?:\d+\s+){6}(\d+)",
            "dalvikHeapPssKiB": r"^\s*Dalvik Heap\s+(\d+)",
        }.items():
            match = re.search(pattern, raw, re.MULTILINE)
            if match:
                sample[name] = int(match.group(1))
        if sample:
            if baseline is None:
                baseline = sample
            for key, value in sample.items():
                peak[key] = max(peak.get(key, 0), value)
            samples += 1
    except subprocess.SubprocessError:
        failed += 1
    summary = {"baseline": baseline, "sampledPeak": peak, "samples": samples,
               "failedSamples": failed, "intervalSeconds": 0.5,
               "elapsedSeconds": time.monotonic() - started}
    output.write_text(json.dumps(summary, indent=2) + "\n")
    time.sleep(0.5)
print(json.dumps(summary))
