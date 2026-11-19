#!/usr/bin/env bash
set -euo pipefail
capture() {
  adb logcat -d | python3 -c '
import base64,json,os,sys
text=sys.stdin.read()
cookie=os.environ.get("TEST_SESSION_COOKIE", "")
native=os.environ.get("TEST_NATIVE_SESSION", "")
for value in [cookie,cookie.partition("=")[2],native,base64.b64encode(native.encode()).decode(),json.loads(native).get("token", "") if native else ""]:
    if value: text=text.replace(value,"<REDACTED>")
print(text)
' > acceptance/launch-log.txt
  adb exec-out screencap -p > acceptance/android-current.png
}
trap capture EXIT
wait_for_ui() {
  local file=$1 pattern=$2
  for attempt in {1..18}; do
    sleep 1
    adb shell uiautomator dump /sdcard/window.xml >/dev/null
    adb pull /sdcard/window.xml "acceptance/$file.xml" >/dev/null 2>&1
    if grep -q "Pixel Launcher isn't responding" "acceptance/$file.xml"; then
      python3 - "acceptance/$file.xml" <<'PY_ANR' | xargs adb shell input tap
import re, sys, xml.etree.ElementTree as ET
for node in ET.parse(sys.argv[1]).iter('node'):
    if node.get('text') == 'Close app':
        x1,y1,x2,y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
        print((x1+x2)//2, (y1+y2)//2)
        break
else:
    raise SystemExit('Launcher ANR close button missing')
PY_ANR
      adb shell am start -W -n com.shotloom.app.preview/.MainActivity
      continue
    fi
    if grep -Eq "$pattern" "acceptance/$file.xml"; then return; fi
    sleep 4
  done
  echo "Expected screen did not appear: $file"
  return 1
}
adb shell wm size 750x1624
adb shell wm density 320
adb shell settings put global private_dns_mode off
expected_dns=$(python3 -c "import socket; print(socket.gethostbyname('shotloom.0xfiang.com'))")
device_dns=''
for attempt in {1..18}; do
  device_dns=$(adb shell ping -c 1 -W 1 shotloom.0xfiang.com 2>&1 || true)
  if [[ "$device_dns" == *"$expected_dns"* ]]; then break; fi
  sleep 2
done
printf '%s\n' "$device_dns" > acceptance/device-dns.txt
[[ "$device_dns" == *"$expected_dns"* ]]
if [ -n "$BASELINE_RUN" ]; then adb install baseline/Shotloom-Preview.apk; else adb install acceptance/Shotloom-Preview.apk; fi
adb logcat -c
adb shell am start -W -n com.shotloom.app.preview/.MainActivity
wait_for_ui window 'new-api|让创作|Sign in|Log in'
adb exec-out screencap -p > acceptance/android-launch.png
test -n "$TEST_SESSION_COOKIE"
native_session=$(printf '%s' "${TEST_NATIVE_SESSION:-}" | base64 -w0)
session_args=()
if [ -n "$native_session" ]; then session_args=(-e sessionBase64 "$native_session"); fi
adb shell am force-stop com.shotloom.app.preview
adb install acceptance/Shotloom-Session-Test.apk
adb shell am instrument -w -e cookie "$TEST_SESSION_COOKIE" "${session_args[@]}" com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > acceptance/session-setup.txt
grep 'Test session installed' acceptance/session-setup.txt
adb shell am start -W -n com.shotloom.app.preview/.MainActivity
if [ -n "$BASELINE_RUN" ]; then
  wait_for_ui baseline 'Checking your session|正在检查登录状态'
  sleep 10
  wait_for_ui baseline 'Checking your session|正在检查登录状态'
  adb shell am force-stop com.shotloom.app.preview
  adb install -r acceptance/Shotloom-Preview.apk
  adb shell am start -W -n com.shotloom.app.preview/.MainActivity
fi
wait_for_ui authenticated '项目库|Project library'
! grep -E 'Checking your session|正在检查登录状态' acceptance/authenticated.xml
adb exec-out screencap -p > acceptance/android-authenticated.png
tap_text() {
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb pull /sdcard/window.xml acceptance/current.xml >/dev/null 2>&1
  local coords
  coords=$(python3 - "$1" "${2:-first}" <<'PY'
import re, sys, xml.etree.ElementTree as ET
matches=[]
for node in ET.parse('acceptance/current.xml').iter('node'):
    if sys.argv[2] == 'switch' and 'Switch' not in node.get('class', ''):
        continue
    if sys.argv[2] == 'input' and node.get('class') != 'android.widget.EditText':
        continue
    if any(re.search(sys.argv[1], label) for label in [node.get('text', ''), node.get('content-desc', '')]):
        x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds','')))
        if x2>x1 and y2>y1:
            matches.append(((x1+x2)//2,(y1+y2)//2))
if not matches:
    raise SystemExit('Missing UI target: '+sys.argv[1])
print(*(matches[-1] if sys.argv[2] == 'last' else matches[0]))
PY
)
  adb shell input tap $coords
}
source .github/scripts/native-layout-acceptance.sh
if [ "${LAYOUT_ONLY:-false}" = true ]; then
  verify_native_layout
  exit 0
fi

tap_text '^我的$|^My account$'
wait_for_ui account '可用积分|Available credits'
adb exec-out screencap -p > acceptance/android-account.png

adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
wait_for_ui account-landscape '可用积分|Available credits'
adb exec-out screencap -p > acceptance/android-account-landscape.png
adb shell settings put system user_rotation 0
wait_for_ui account '可用积分|Available credits'
adb shell input swipe 380 1260 380 700 500
tap_text '^通知$|^Notifications$'
wait_for_ui notifications-empty '暂无通知|No notifications'
adb exec-out screencap -p > acceptance/android-notifications-empty.png
adb shell input keyevent 4

tap_text '反馈与举报|Feedback and reports'
wait_for_ui feedback '问题描述|Description'
adb exec-out screencap -p > acceptance/android-feedback.png
tap_text '我的记录|My records'
wait_for_ui records '暂无记录|No records'
adb exec-out screencap -p > acceptance/android-records-empty.png
adb shell input keyevent 4
wait_for_ui feedback '问题描述|Description'
tap_text '^类型$|^Type$' last
wait_for_ui kind 'text="举报"|text="Report"'
tap_text '^举报$|^Report$'
tap_text '^问题描述$|^Description$' input
adb shell input text Android_UI_visual_acceptance
adb shell input keyevent 4
tap_text '^提交反馈或举报$|^Submit feedback or report$' last
wait_for_ui feedback-detail '后台回复|[Rr]eplies'
grep 'Android_UI_visual_acceptance' acceptance/feedback-detail.xml
adb exec-out screencap -p > acceptance/android-feedback-detail.png
adb shell input keyevent 4
wait_for_ui account '反馈问题或举报内容|Feedback and reports'
tap_text '反馈与举报|Feedback and reports'
wait_for_ui feedback '问题描述|Description'
tap_text '我的记录|My records'
wait_for_ui records 'Android_UI_visual_acceptance'
adb exec-out screencap -p > acceptance/android-records.png
adb shell input keyevent 4
wait_for_ui feedback '问题描述|Description'
adb shell input keyevent 4
wait_for_ui account '反馈问题或举报内容|Feedback and reports'
for attempt in {1..3}; do
  tap_text '^通知$|^Notifications$'
  sleep 2
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb pull /sdcard/window.xml acceptance/notifications.xml >/dev/null 2>&1
  if grep -Eq '全部消息|All messages' acceptance/notifications.xml; then break; fi
done
wait_for_ui notifications '全部消息|All messages'
# A server-side fixture replies only after this isolated user's report exists.
for attempt in {1..18}; do
  tap_text '^刷新$|^Refresh$'
  sleep 5
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb pull /sdcard/window.xml acceptance/notifications.xml >/dev/null 2>&1
  if grep -q 'Android_notification_acceptance' acceptance/notifications.xml; then break; fi
done
grep 'Android_notification_acceptance' acceptance/notifications.xml
! grep -E 'Checking your session|正在检查登录状态' acceptance/notifications.xml
! grep -E '提交反馈或举报|Submit feedback or report|我的记录|My records' acceptance/notifications.xml
adb exec-out screencap -p > acceptance/android-notifications.png
tap_text '^全部标记已读$|^Mark all as read$'
wait_for_ui notifications-read '查看回复|View reply'
adb exec-out screencap -p > acceptance/android-notifications-read.png
tap_text 'Android_notification_acceptance'
wait_for_ui notification-reply 'Android_notification_acceptance'
adb exec-out screencap -p > acceptance/android-notification-reply.png
adb shell input keyevent 4
wait_for_ui notifications '查看回复|View reply'
adb shell input keyevent 4
tap_text '^技能$|^Skills$'
wait_for_ui skills 'Native Acceptance Skill'
! grep -E 'Checking your session|正在检查登录状态|android.webkit.WebView' acceptance/skills.xml
adb exec-out screencap -p > acceptance/android-skills.png
tap_text '^Native Acceptance Skill$'
wait_for_ui skill-editor 'text="编辑技能"|text="Edit skill"'
adb exec-out screencap -p > acceptance/android-skill-editor.png
adb shell input keyevent 4
capture
! grep -E 'FATAL EXCEPTION|ReactNativeJS.*(Error:|Invariant Violation)' acceptance/launch-log.txt

# Inspect the same signed release; only the separate test APK enables CDP.
adb shell am force-stop com.shotloom.app.preview
adb shell am instrument -w -e cookie "$TEST_SESSION_COOKIE" "${session_args[@]}" -e debug 1 com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > acceptance/canvas-instrumentation.txt &
wait_for_ui canvas-library 'Android Canvas Acceptance'
pid=$(adb shell pidof com.shotloom.app.preview | tr -d '\r')
if [ -z "${TEST_NATIVE_SESSION:-}" ]; then
adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"
node .github/scripts/native-session-reload-cdp.mjs > acceptance/session-reload-cdp.txt 2>&1 &
reload_check=$!
for attempt in {1..60}; do
  if [ -f acceptance/session-reload-blocked.json ]; then break; fi
  if ! kill -0 "$reload_check" 2>/dev/null; then cat acceptance/session-reload-cdp.txt; exit 1; fi
  sleep 1
done
test -f acceptance/session-reload-blocked.json
wait_for_ui session-reload 'Android Canvas Acceptance'
! grep -E 'Checking your session|正在检查登录状态|android.webkit.WebView' acceptance/session-reload.xml
adb exec-out screencap -p > acceptance/android-session-reload.png
touch acceptance/session-reload-release.marker
for attempt in {1..60}; do
  if [ -f acceptance/session-expired.marker ]; then break; fi
  if ! kill -0 "$reload_check" 2>/dev/null; then cat acceptance/session-reload-cdp.txt; exit 1; fi
  sleep 1
done
test -f acceptance/session-expired.marker
wait_for_ui session-expired 'new-api|让创作|Sign in|Log in'
adb exec-out screencap -p > acceptance/android-session-expired.png
touch acceptance/session-expired-verified.marker
wait "$reload_check"
wait_for_ui session-recovered 'Android Canvas Acceptance'

node .github/scripts/native-pages-cdp.mjs > acceptance/pages-cdp.txt 2>&1 &
pages_check=$!
for attempt in {1..30}; do
  if [ -f acceptance/pages-attached.marker ]; then break; fi
  if ! kill -0 "$pages_check" 2>/dev/null; then cat acceptance/pages-cdp.txt; exit 1; fi
  sleep 1
done
test -f acceptance/pages-attached.marker
fi
tap_text '^我的$|^My account$'
wait_for_ui account '可用积分|Available credits'
tap_text '^设置$|^Settings$'
wait_for_ui settings '偏好设置|Preferences'
! grep 'android.webkit.WebView' acceptance/settings.xml
adb exec-out screencap -p > acceptance/android-settings.png
adb shell input swipe 380 1280 380 650 500
wait_for_ui settings-agent '创建后自动整理|Arrange after creation'
adb exec-out screencap -p > acceptance/android-settings-agent.png
tap_text '创建后自动整理|Arrange after creation' switch
setting_saved=0
for attempt in {1..15}; do
  adb shell uiautomator dump /sdcard/window.xml >/dev/null
  adb pull /sdcard/window.xml acceptance/settings-saved.xml >/dev/null 2>&1
  if python3 -c 'import re,xml.etree.ElementTree as ET; assert any("Switch" in n.get("class", "") and re.search("创建后自动整理|Arrange after creation", n.get("content-desc", "")) and n.get("checked")=="false" and n.get("enabled")=="true" for n in ET.parse("acceptance/settings-saved.xml").iter("node"))'; then setting_saved=1; break; fi
  sleep 2
done
test "$setting_saved" = 1
adb shell input keyevent 4
wait_for_ui account '可用积分|Available credits'
tap_text '^技能$|^Skills$'
wait_for_ui skills 'Native Acceptance Skill'
tap_text '^项目库$|^Project library$' last
wait_for_ui canvas-library 'Android Canvas Acceptance'
if [ -z "${TEST_NATIVE_SESSION:-}" ]; then
touch acceptance/pages-warm.marker
for attempt in {1..15}; do
  if [ -f acceptance/pages-counting.marker ]; then break; fi
  sleep 1
done
test -f acceptance/pages-counting.marker
for roundtrip in 1 2; do
  tap_text '^我的$|^My account$'
  wait_for_ui account '可用积分|Available credits'
  tap_text '^技能$|^Skills$'
  wait_for_ui skills 'Native Acceptance Skill'
  tap_text '^项目库$|^Project library$' last
  wait_for_ui canvas-library 'Android Canvas Acceptance'
done
touch acceptance/pages-roundtrip.marker
wait "$pages_check"
fi
# Native sessions have no background WebView to inspect; exercise the actual workspace below.
pid=$(adb shell pidof com.shotloom.app.preview | tr -d '\r')
adb forward tcp:9222 "localabstract:webview_devtools_remote_$pid"
node .github/scripts/native-canvas-cdp.mjs > acceptance/canvas-cdp.txt 2>&1 &
canvas_check=$!
tap_text 'Android Canvas Acceptance'
for attempt in {1..90}; do
  if [ -f acceptance/canvas-ready.json ]; then break; fi
  if ! kill -0 "$canvas_check" 2>/dev/null; then cat acceptance/canvas-cdp.txt; exit 1; fi
  sleep 1
done
test -f acceptance/canvas-ready.json
adb exec-out screencap -p > acceptance/android-canvas-ready.png
wait_for_ui canvas '100%'
adb exec-out screencap -p > acceptance/android-canvas.png
tap_text '^＋$'
wait_for_ui canvas-zoom '110%'
adb exec-out screencap -p > acceptance/android-canvas-zoom.png
touch acceptance/canvas-zoom.marker
for attempt in {1..15}; do
  if [ -f acceptance/canvas-zoom.json ]; then break; fi
  sleep 1
done
test -f acceptance/canvas-zoom.json
adb shell input swipe 320 950 450 1100 600
sleep 2
touch acceptance/canvas-pan.marker
for attempt in {1..15}; do
  if [ -f acceptance/canvas-interaction.json ]; then break; fi
  sleep 1
done
test -f acceptance/canvas-interaction.json
adb exec-out screencap -p > acceptance/android-canvas-pan.png
adb shell input keyevent 4
wait_for_ui canvas-return 'Android Canvas Acceptance'
tap_text 'Android Canvas Acceptance'
wait_for_ui canvas-reopen '110%'
touch acceptance/canvas-reopen.marker
wait "$canvas_check"
adb exec-out screencap -p > acceptance/android-canvas-reopen.png

verify_native_layout
