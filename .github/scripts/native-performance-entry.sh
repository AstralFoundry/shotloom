#!/usr/bin/env bash
set -euo pipefail
if [ "${PAIRED:-false}" != true ]; then
  exec bash .github/scripts/native-performance.sh
fi
diagnostics() {
  { free -m; df -h; sudo dmesg | tail -80; } > perf/diagnostics.txt
  adb exec-out screencap -p > perf/failure.png || true
}
trap diagnostics ERR
[[ "${PAIRS:-10}" =~ ^([1-9]|10)$ ]]
adb shell wm size 750x1624
adb shell wm density 320
adb shell settings put global private_dns_mode off
adb shell settings put system font_scale 1.0
expected_dns=$(python3 -c "import socket; print(socket.gethostbyname('shotloom.0xfiang.com'))")
device_dns=''
for attempt in {1..18}; do
  device_dns=$(adb shell ping -c 1 -W 1 shotloom.0xfiang.com 2>&1 || true)
  if [[ "$device_dns" == *"$expected_dns"* ]]; then break; fi
  sleep 2
done
[[ "$device_dns" == *"$expected_dns"* ]]
adb shell am force-stop com.google.android.apps.nexuslauncher
sleep 3
adb shell getprop ro.build.fingerprint > perf/device.txt
adb install --no-incremental perf/measure.apk
native_session=$(printf '%s' "$TEST_NATIVE_SESSION" | base64 -w0)
token=$(printf '%s' "$TEST_NATIVE_SESSION" | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
project=$(printf '%s' "$TEST_FIXTURE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["projectId"])')
feedback=$(printf '%s' "$TEST_FIXTURE" | python3 -c 'import json,sys;print(json.load(sys.stdin)["feedbackId"])')
for ((pair=1;pair<=${PAIRS:-10};pair++)); do
  # Alternate order to reduce systematic cache and time-of-run bias.
  order='baseline candidate'
  if (( pair % 2 == 0 )); then order='candidate baseline'; fi
  for version in $order; do
    directory=acceptance; origin="$CANDIDATE_ORIGIN"
    if [ "$version" = baseline ]; then directory=baseline; origin="$BASELINE_ORIGIN"; fi
    adb shell am force-stop com.shotloom.app.preview
    sleep 2
    adb uninstall com.shotloom.acceptance >/dev/null 2>&1 || true
    adb uninstall com.shotloom.app.preview >/dev/null 2>&1 || true
    adb install --no-incremental "$directory/Shotloom-Preview.apk"
    # Both apps have the same signing identity; the new test APK supports isolated origins.
    adb install --no-incremental acceptance/Shotloom-Session-Test.apk
    adb shell am instrument -w -e origin "$origin" -e cookie "$TEST_SESSION_COOKIE" -e sessionBase64 "$native_session" com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > /tmp/session-seeded.txt
    grep -q 'Test session installed' /tmp/session-seeded.txt
    for state in cold warm; do
      adb shell am instrument -w -e origin "$origin" -e rounds 1 -e token "$token" -e cookie "$TEST_SESSION_COOKIE" -e projectId "$project" -e feedbackId "$feedback" com.shotloom.performance/com.shotloom.performance.NativePerformance > /tmp/performance-output.txt
      python3 - "$pair" "$version" "$state" <<'PY'
import json,sys
text=open('/tmp/performance-output.txt').read()
line=next((s.split('PERFORMANCE_JSON ',1)[1] for s in text.splitlines() if 'PERFORMANCE_JSON ' in s),None)
assert line is not None, 'Measurement output missing'
result=json.loads(line)
result.update(pair=int(sys.argv[1]),version=sys.argv[2],state=sys.argv[3])
with open('perf/results-'+ '-'.join(sys.argv[1:])+'.json','w') as f: json.dump(result,f,indent=2)
print('Pair',sys.argv[1],sys.argv[2],sys.argv[3],len(result['pages']),'page samples; failure:',result['failure'])
assert result['failure'] is None, result['failure']
assert all(row['status']==200 for row in result['apis']), 'API error during measurement'
PY
      adb exec-out screencap -p > "perf/screen-$pair-$version-$state.png"
    done
  done
done

# Functional checks run after all timed pairs and are excluded from their statistics.
adb shell am force-stop com.shotloom.app.preview
sleep 2
adb uninstall com.shotloom.acceptance >/dev/null
adb uninstall com.shotloom.app.preview >/dev/null
adb install --no-incremental acceptance/Shotloom-Preview.apk
adb install --no-incremental acceptance/Shotloom-Session-Test.apk
adb shell am instrument -w -e origin "$CANDIDATE_ORIGIN" -e cookie "$TEST_SESSION_COOKIE" -e sessionBase64 "$native_session" com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > /tmp/session-seeded.txt
grep -q 'Test session installed' /tmp/session-seeded.txt
adb shell settings put system font_scale 1.3
adb shell am instrument -w -e mode layout -e origin "$CANDIDATE_ORIGIN" com.shotloom.performance/com.shotloom.performance.NativePerformance > /tmp/layout-output.txt
python3 - <<'PY'
import json
text=open('/tmp/layout-output.txt').read()
line=next((s.split('PERFORMANCE_JSON ',1)[1] for s in text.splitlines() if 'PERFORMANCE_JSON ' in s),None)
assert line is not None, 'Layout validation output missing'
result=json.loads(line)
with open('perf/layout-validation.json','w') as f: json.dump(result,f,indent=2)
assert result['failure'] is None and result['chineseAndEnglish'] and result['nativeSettings'] and result['fontScale'] >= 1.29
print('Large-font native settings and Chinese/English preference save passed')
PY
adb exec-out screencap -p > perf/layout-large.png
adb shell settings put system font_scale 1.0

# Inspect real media using only the separately signed instrumentation's CDP switch.
adb shell am force-stop com.shotloom.app.preview
adb shell am instrument -w -e debug 1 -e origin "$CANDIDATE_ORIGIN" -e cookie "$TEST_SESSION_COOKIE" -e sessionBase64 "$native_session" com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > /tmp/media-debug-session.txt &
debug_seed=$!
sleep 3
adb shell am instrument -w -e mode media -e retain true -e origin "$CANDIDATE_ORIGIN" com.shotloom.performance/com.shotloom.performance.NativePerformance > /tmp/media-output.txt
grep -q 'PERFORMANCE_JSON' /tmp/media-output.txt
pid=$(adb shell pidof com.shotloom.app.preview | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"
node .github/scripts/native-media-evidence.mjs > perf/media-evidence.log 2>&1 &
media_check=$!
for attempt in {1..120}; do
  if [ -f perf/media-ready.json ]; then break; fi
  if ! kill -0 "$media_check" 2>/dev/null; then cat perf/media-evidence.log; exit 1; fi
  sleep 1
done
test -f perf/media-ready.json
adb exec-out screencap -p > perf/media-first-frame.png
adb shell am instrument -w -e mode return-media -e retain true -e origin "$CANDIDATE_ORIGIN" com.shotloom.performance/com.shotloom.performance.NativePerformance > /tmp/media-return-output.txt
grep -q 'PERFORMANCE_JSON' /tmp/media-return-output.txt
touch perf/media-return.marker
for attempt in {1..60}; do
  if [ -f perf/media-preserved.json ]; then break; fi
  if ! kill -0 "$media_check" 2>/dev/null; then cat perf/media-evidence.log; exit 1; fi
  sleep 1
done
test -f perf/media-preserved.json
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell am start -W -n com.shotloom.app.preview/.MainActivity
touch perf/media-resumed.marker
wait "$media_check"
cat perf/media-evidence.log
adb shell am force-stop com.shotloom.app.preview
wait "$debug_seed" || true
