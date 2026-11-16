#!/usr/bin/env bash
set -euo pipefail
capture() {
  adb logcat -d | python3 -c 'import os,sys; cookie=os.environ.get("TEST_SESSION_COOKIE", ""); text=sys.stdin.read(); print(text.replace(cookie,"<REDACTED>").replace(cookie.partition("=")[2],"<REDACTED>") if cookie else text)' > acceptance/launch-log.txt
  adb exec-out screencap -p > acceptance/android-current.png
}
trap capture EXIT
wait_for_ui() {
  local file=$1 pattern=$2
  for attempt in {1..18}; do
    sleep 5
    adb shell uiautomator dump /sdcard/window.xml >/dev/null
    adb pull /sdcard/window.xml "acceptance/$file.xml" >/dev/null 2>&1
    if grep -Eq "$pattern" "acceptance/$file.xml"; then return; fi
  done
  echo "Expected screen did not appear: $file"
  return 1
}
adb shell wm size 750x1624
adb shell wm density 320
if [ -n "$BASELINE_RUN" ]; then adb install baseline/Shotloom-Preview.apk; else adb install acceptance/Shotloom-Preview.apk; fi
adb logcat -c
adb shell am start -W -n com.shotloom.app.preview/.MainActivity
wait_for_ui window 'new-api|让创作|Sign in|Log in'
adb exec-out screencap -p > acceptance/android-launch.png
test -n "$TEST_SESSION_COOKIE"
adb shell am force-stop com.shotloom.app.preview
adb install acceptance/Shotloom-Session-Test.apk
adb shell am instrument -w -e cookie "$TEST_SESSION_COOKIE" com.shotloom.acceptance/com.shotloom.acceptance.SessionInstrumentation > acceptance/session-setup.txt
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
tap_text '^我的$|^My account$'
wait_for_ui account '可用积分|Available credits'
adb exec-out screencap -p > acceptance/android-account.png
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
wait_for_ui account-landscape '可用积分|Available credits'
adb exec-out screencap -p > acceptance/android-account-landscape.png
adb shell settings put system user_rotation 0
wait_for_ui account '可用积分|Available credits'
tap_text '反馈与举报|Feedback and reports'
wait_for_ui feedback '问题描述|Description'
adb exec-out screencap -p > acceptance/android-feedback.png
tap_text '我的记录|My records'
wait_for_ui records '暂无记录|No records'
adb exec-out screencap -p > acceptance/android-records.png
adb shell input keyevent 4
wait_for_ui feedback '问题描述|Description'
tap_text '^类型$|^Type$'
wait_for_ui kind '举报|Report'
tap_text '^举报$|^Report$'
tap_text '^问题描述$|^Description$' input
adb shell input text Android_UI_visual_acceptance
adb shell input keyevent 4
tap_text '^提交反馈或举报$|^Submit feedback or report$' last
wait_for_ui feedback-detail '后台回复|[Rr]eplies'
grep 'Android_UI_visual_acceptance' acceptance/feedback-detail.xml
adb exec-out screencap -p > acceptance/android-feedback-detail.png
adb shell input keyevent 4
wait_for_ui account '可用积分|Available credits'
tap_text '^通知$|^Notifications$'
wait_for_ui notifications '暂无通知|No notifications'
adb exec-out screencap -p > acceptance/android-notifications.png
capture
! grep -E 'FATAL EXCEPTION|ReactNativeJS.*(Error:|Invariant Violation)' acceptance/launch-log.txt
