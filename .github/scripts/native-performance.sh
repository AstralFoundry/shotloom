#!/usr/bin/env bash
set -euo pipefail
trap 'adb exec-out screencap -p > perf/failure.png' ERR
adb shell wm size 750x1624
adb shell wm density 320
adb shell settings put global private_dns_mode off
adb shell settings put system font_scale 1.0
adb install acceptance/Shotloom-Preview.apk
adb install acceptance/Shotloom-Session-Test.apk
adb install perf/measure.apk
if [ "${LOGIN_ONLY:-false}" = true ]; then
  adb shell am instrument -w -e mode login com.shotloom.performance/com.shotloom.performance.NativePerformance > /tmp/performance-output.txt
  python3 - <<'PY'
import json
text=open('/tmp/performance-output.txt').read()
line=next(s.split('PERFORMANCE_JSON ',1)[1] for s in text.splitlines() if 'PERFORMANCE_JSON ' in s)
result=json.loads(line)
with open('perf/results-login.json','w') as f: json.dump(result,f,indent=2)
assert len(result['pages'])==3 and result['failure'] is None, result['failure']
print('Native login cold launch:',[r['ms'] for r in result['pages']])
PY
  exit 0
fi
native_session=$(printf '%s' "$TEST_NATIVE_SESSION" | base64 -w0)
adb shell am instrument -w -e cookie "$TEST_SESSION_COOKIE" -e sessionBase64 "$native_session" com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > /tmp/session-seeded.txt
grep -q 'Test session installed' /tmp/session-seeded.txt
token=$(printf '%s' "$TEST_NATIVE_SESSION" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
project=$(printf '%s' "$TEST_FIXTURE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["projectId"])')
feedback=$(printf '%s' "$TEST_FIXTURE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["feedbackId"])')
adb shell getprop ro.build.fingerprint > perf/device.txt
for run in 1 2 3; do
  adb shell am instrument -w -e token "$token" -e cookie "$TEST_SESSION_COOKIE" -e projectId "$project" -e feedbackId "$feedback" com.shotloom.performance/com.shotloom.performance.NativePerformance > /tmp/performance-output.txt
  python3 - "$run" <<'PY'
import json,sys
text=open('/tmp/performance-output.txt').read()
line=next((s.split('PERFORMANCE_JSON ',1)[1] for s in text.splitlines() if 'PERFORMANCE_JSON ' in s),None)
if line is None: raise SystemExit('Measurement output missing')
result=json.loads(line)
with open('perf/results-'+sys.argv[1]+'.json','w') as f: json.dump(result,f,indent=2)
print('Run',sys.argv[1],':',len(result['pages']),'page samples;',len(result['apis']),'API samples; failure:',result['failure'])
if result['failure']: raise SystemExit(1)
PY
done
