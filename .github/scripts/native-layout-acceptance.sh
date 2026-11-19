#!/usr/bin/env bash
# Sourced after the signed APK/session setup and UI helpers in native-acceptance.sh.
open_native_settings() {
  tap_text '^My account$'
  wait_for_ui account-ready 'content-desc="Refresh balance"[^>]*enabled="true"'
  adb shell input swipe 380 1250 380 600 500
  sleep 1
  for attempt in {1..3}; do
    tap_text '^Settings'
    sleep 1
    adb shell uiautomator dump /sdcard/window.xml >/dev/null
    adb pull /sdcard/window.xml acceptance/open-settings.xml >/dev/null 2>&1
    if grep -q 'Preferences' acceptance/open-settings.xml; then return; fi
  done
  echo 'Native settings did not open'
  return 1
}
verify_native_layout() {
  open_native_settings
  wait_for_ui settings-english 'Preferences'
  adb exec-out screencap -p > acceptance/android-settings-english.png
  adb shell settings put system font_scale 1.3
  adb shell am force-stop com.shotloom.app.preview
  adb shell am start -W -n com.shotloom.app.preview/.MainActivity
  wait_for_ui font-restarted 'Project library'
  open_native_settings
  wait_for_ui settings-large 'Preferences'
  adb exec-out screencap -p > acceptance/android-settings-english-large.png
  for attempt in {1..4}; do
    adb shell input swipe 380 1250 380 650 500
    sleep 1
    adb shell uiautomator dump /sdcard/window.xml >/dev/null
    adb pull /sdcard/window.xml acceptance/settings-large-models.xml >/dev/null 2>&1
    if grep -q 'Default models' acceptance/settings-large-models.xml; then break; fi
  done
  grep 'Default models' acceptance/settings-large-models.xml >/dev/null
  adb exec-out screencap -p > acceptance/android-settings-english-large-models.png
  ! grep 'android.webkit.WebView' acceptance/settings-large-models.xml
  adb shell input keyevent 4
  wait_for_ui home-large 'My account'
  adb exec-out screencap -p > acceptance/android-home-english-large.png
  python3 - <<'PY_TABS'
import re, xml.etree.ElementTree as ET
labels = {'Project library', 'Project canvas', 'Skills', 'My account'}
tops = {}
for node in ET.parse('acceptance/home-large.xml').iter('node'):
    label = node.get('content-desc', '')
    if label not in labels: continue
    icon = next((child for child in node.iter('node') if child.get('class') == 'com.horcrux.svg.SvgView'), None)
    if icon is not None: tops[label] = list(map(int, re.findall(r'\d+', icon.get('bounds', ''))))[1]
assert set(tops) == labels, tops
assert max(tops.values()) - min(tops.values()) <= 1, tops
print('English large-font tab icons aligned:', tops)
PY_TABS
  adb shell settings put system font_scale 1.0
}
