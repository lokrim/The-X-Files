"""Development-only adb UI helper. Emits only requested labels and coordinates.

Never prints the hierarchy, unrelated screen text, URIs or selected-file names.
"""
import argparse
import json
import re
import subprocess
import uuid
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument("action", choices=["find", "tap", "controls"])
parser.add_argument("label", nargs="?", default="")
args = parser.parse_args()
stage = "DUMP"
try:
    temporary = "/data/local/tmp/xfiles-p01b-ui-" + uuid.uuid4().hex + ".xml"
    try:
        subprocess.run(
            ["adb", "shell", "uiautomator", "dump", temporary],
            capture_output=True, text=True, timeout=35, check=True,
        )
        stage = "READ"
        result = subprocess.run(["adb", "exec-out", "cat", temporary], capture_output=True, text=True, timeout=10, check=True)
        raw = result.stdout
    finally:
        subprocess.run(["adb", "shell", "rm", "-f", temporary], capture_output=True, timeout=10)
    stage = "PARSE"
    start = raw.find("<?xml")
    end = raw.rfind("</hierarchy>")
    if start < 0 or end < 0:
        raise ValueError()
    root = ET.fromstring(raw[start:end + len("</hierarchy>")])
    if args.action == "controls":
        known = ["Use this folder", "Select", "Done", "Allow", "Cancel", "Downloads", "Internal storage", "Show roots", "Navigate up", "Save", "Choose", "OK", "Open", "Search"]
        controls = []
        for node in root.iter("node"):
            values = [node.get("text", ""), node.get("content-desc", "")]
            for label in known:
                if any(label.casefold() == value.casefold() for value in values):
                    controls.append({"label": label, "enabled": node.get("enabled") == "true", "bounds": node.get("bounds")})
        print(json.dumps({"controls": controls}))
        raise SystemExit(0)
    matches = []
    for node in root.iter("node"):
        values = [re.sub(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069]", "", node.get(key, "")) for key in ("text", "content-desc", "resource-id")]
        wanted = args.label.casefold()
        if not any(value.casefold() == wanted or value.casefold().startswith(wanted + ",") for value in values):
            continue
        coords = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if coords and node.get("enabled") == "true":
            left, top, right, bottom = map(int, coords.groups())
            if right > left and bottom > top:
                matches.append(((left + right) // 2, (top + bottom) // 2))
    if args.action == "tap" and len(matches) == 1:
        subprocess.run(["adb", "shell", "input", "tap", *map(str, matches[0])], check=True, capture_output=True)
    # Do not repeat the requested label: it may be a synthetic fixture filename.
    print(json.dumps({"matches": len(matches), "centres": matches, "tapped": args.action == "tap" and len(matches) == 1}))
except (ValueError, ET.ParseError, subprocess.SubprocessError) as error:
    print(json.dumps({"reason": "DEVICE_UI_UNAVAILABLE", "stage": stage,
                      "exitCode": error.returncode if isinstance(error, subprocess.CalledProcessError) else None}))
    raise SystemExit(1)
