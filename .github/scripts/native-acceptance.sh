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
wait_for_ui authenticated 'Open workspace|打开工作区'
! grep -E 'Checking your session|正在检查登录状态' acceptance/authenticated.xml
adb exec-out screencap -p > acceptance/android-authenticated.png
capture
! grep -E 'FATAL EXCEPTION|ReactNativeJS.*(Error:|Invariant Violation)' acceptance/launch-log.txt
