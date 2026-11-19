package com.shotloom.performance;

import android.app.Instrumentation;
import android.app.UiAutomation;
import android.content.Intent;
import android.graphics.Rect;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import org.json.JSONArray;
import org.json.JSONObject;

/** Runs beside the unchanged signed release. Timings include network and layout. */
public final class NativePerformance extends Instrumentation {
    private Bundle args;
    private UiAutomation ui;
    private final JSONArray pages = new JSONArray();
    private final JSONArray apis = new JSONArray();
    @Override public void onCreate(Bundle value) { args = value; start(); }
    private AccessibilityNodeInfo find(AccessibilityNodeInfo node, String label) {
        if (node == null) return null;
        if (node.isVisibleToUser() && (label.contentEquals(node.getText() == null ? "" : node.getText()) || label.contentEquals(node.getContentDescription() == null ? "" : node.getContentDescription()))) return node;
        for (int i=0; i<node.getChildCount(); i++) { AccessibilityNodeInfo hit=find(node.getChild(i),label); if(hit!=null)return hit; }
        return null;
    }
    private boolean spinning(AccessibilityNodeInfo node) {
        if(node==null)return false;
        if(node.isVisibleToUser() && String.valueOf(node.getClassName()).contains("ProgressBar"))return true;
        for(int i=0;i<node.getChildCount();i++)if(spinning(node.getChild(i)))return true;
        return false;
    }
    private void waitReady(String label) throws Exception {
        long limit=SystemClock.elapsedRealtime()+60000;
        while(SystemClock.elapsedRealtime()<limit) {
            AccessibilityNodeInfo root=ui.getRootInActiveWindow();
            AccessibilityNodeInfo target=find(root,label);
            if(target!=null && !spinning(root)) {
                if(!label.equals("Available credits"))return;
                AccessibilityNodeInfo balance=find(root,"Refresh balance");
                if(balance!=null && balance.isEnabled())return;
            }
            SystemClock.sleep(25);
        }
        throw new Exception("Readiness timeout: "+label);
    }
    private void pointer(float x,float y,int action,long down) {
        MotionEvent event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,x,y,0);
        event.setSource(InputDevice.SOURCE_TOUCHSCREEN); ui.injectInputEvent(event,true); event.recycle();
    }
    private void swipe() {
        long down=SystemClock.uptimeMillis(); pointer(370,1250,MotionEvent.ACTION_DOWN,down);
        for(int i=1;i<=12;i++){SystemClock.sleep(16);pointer(370,1250-i*50,MotionEvent.ACTION_MOVE,down);}
        pointer(370,650,MotionEvent.ACTION_UP,down); SystemClock.sleep(250);
    }
    private void accountTop() {
        for(int pass=0;pass<3;pass++) {
            long down=SystemClock.uptimeMillis();pointer(370,400,MotionEvent.ACTION_DOWN,down);
            for(int i=1;i<=12;i++){SystemClock.sleep(16);pointer(370,400+i*65,MotionEvent.ACTION_MOVE,down);}
            pointer(370,1180,MotionEvent.ACTION_UP,down);SystemClock.sleep(150);
        }
        SystemClock.sleep(150);
    }
    private void click(String label) throws Exception {
        AccessibilityNodeInfo node=null;
        for(int i=0;i<5;i++){ node=find(ui.getRootInActiveWindow(),label);if(node!=null)break;swipe(); }
        if(node==null)throw new Exception("Target missing: "+label);
        Rect bounds=new Rect();node.getBoundsInScreen(bounds);
        long down=SystemClock.uptimeMillis();pointer(bounds.centerX(),bounds.centerY(),MotionEvent.ACTION_DOWN,down);pointer(bounds.centerX(),bounds.centerY(),MotionEvent.ACTION_UP,down);
    }
    private void back() {
        long now=SystemClock.uptimeMillis();ui.injectInputEvent(new KeyEvent(now,now,KeyEvent.ACTION_DOWN,KeyEvent.KEYCODE_BACK,0),true);ui.injectInputEvent(new KeyEvent(now,now,KeyEvent.ACTION_UP,KeyEvent.KEYCODE_BACK,0),true);
        SystemClock.sleep(200);
    }
    private void page(String name,String target,String ready,int round) throws Exception {
        // Locate controls before timing: automated scrolling is outside the page transition.
        AccessibilityNodeInfo node=null;
        for(int i=0;i<5;i++){node=find(ui.getRootInActiveWindow(),target);if(node!=null)break;swipe();}
        if(node==null)throw new Exception("Target missing: "+target);
        Rect bounds=new Rect();node.getBoundsInScreen(bounds);
        long start=SystemClock.elapsedRealtime(),down=SystemClock.uptimeMillis();
        pointer(bounds.centerX(),bounds.centerY(),MotionEvent.ACTION_DOWN,down);pointer(bounds.centerX(),bounds.centerY(),MotionEvent.ACTION_UP,down);waitReady(ready);
        JSONObject row=new JSONObject().put("page",name).put("round",round).put("ms",SystemClock.elapsedRealtime()-start).put("atMs",SystemClock.elapsedRealtime());
        if(name.equals("account"))row.put("upstreamError",find(ui.getRootInActiveWindow(),"Could not load your balance. Please try again.")!=null);
        pages.put(row);
        SystemClock.sleep(120);
    }
    private void api(String path,int round) throws Exception {
        long start=SystemClock.elapsedRealtime();HttpURLConnection conn=(HttpURLConnection)new URL("https://shotloom.0xfiang.com/api"+path).openConnection();
        if(path.startsWith("/project/"))conn.setRequestProperty("Cookie",args.getString("cookie"));else conn.setRequestProperty("Authorization","Bearer "+args.getString("token"));conn.setConnectTimeout(30000);conn.setReadTimeout(30000);
        int status=conn.getResponseCode();long headers=SystemClock.elapsedRealtime();int bytes=0;
        InputStream stream=status>=400?conn.getErrorStream():conn.getInputStream();
        if(stream!=null){byte[] buffer=new byte[8192];int n;while((n=stream.read(buffer))!=-1)bytes+=n;stream.close();}
        apis.put(new JSONObject().put("path",path).put("round",round).put("status",status).put("ttfbMs",headers-start).put("totalMs",SystemClock.elapsedRealtime()-start).put("bytes",bytes));conn.disconnect();
    }
    @Override public void onStart() {
        Bundle result=new Bundle();JSONObject report=new JSONObject();String failure=null;
        try {
            ui=getUiAutomation();
            if("login".equals(args.getString("mode"))) {
                for(int round=0;round<3;round++) {
                    try(InputStream clear=new android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand("pm clear com.shotloom.app.preview"))) {while(clear.read()!=-1) {}}
                    long started=SystemClock.elapsedRealtime();
                    try(InputStream launched=new android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand("am start -W -n com.shotloom.app.preview/.MainActivity"))) {while(launched.read()!=-1) {}}
                    waitReady("Sign in with new-api");
                    pages.put(new JSONObject().put("page","login_native").put("round",round).put("ms",SystemClock.elapsedRealtime()-started));
                }
                report.put("pages",pages).put("apis",apis).put("failure",JSONObject.NULL);
                result.putString("stream","PERFORMANCE_JSON "+report.toString()+"\n");finish(-1,result);return;
            }
            ui.executeShellCommand("am force-stop com.shotloom.app.preview").close();SystemClock.sleep(300);
            long start=SystemClock.elapsedRealtime();
            Intent launch=getContext().getPackageManager().getLaunchIntentForPackage("com.shotloom.app.preview");
            if(launch==null)throw new Exception("Release APK is missing");
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK);getContext().startActivity(launch);
            waitReady("Android Canvas Acceptance");
            pages.put(new JSONObject().put("page","startup_authenticated").put("round",0).put("ms",SystemClock.elapsedRealtime()-start));
            for(int round=0;round<5;round++) {
                page("skills","Skills","Native Acceptance Skill",round);
                page("projects","Project library","Android Canvas Acceptance",round);
                page("account","My account","Available credits",round);
                page("notifications","Notifications","All messages",round);back();accountTop();waitReady("Available credits");
                page("settings","Settings","Preferences",round);back();accountTop();waitReady("Available credits");
                page("feedback_compose","Feedback and reports","Description",round);
                page("feedback_records","My records","Latency_test_record",round);
                page("feedback_detail","Latency_test_record","Replies",round);back();back();back();accountTop();waitReady("Available credits");
                page("projects","Project library","Android Canvas Acceptance",round);
            }
            for(int round=0;round<5;round++) {
                page("canvas","Android Canvas Acceptance","100%",round);
                page("projects","Project library","Android Canvas Acceptance",round);
            }
        } catch(Exception error) {failure=error.getMessage();}
        try {
            String[] paths={"/auth/me","/projects","/library-folders","/catalog/skills","/auth/account","/auth/usage?page=1&page_size=10","/notifications?offset=0&limit=1","/notifications?offset=0&limit=20","/settings/mobile","/models","/feedback?offset=0&limit=20","/feedback/"+args.getString("feedbackId"),"/project/"+args.getString("projectId")};
            if(!"login".equals(args.getString("mode")))for(int round=0;round<5;round++)for(String path:paths)api(path,round);
            report.put("pages",pages).put("apis",apis).put("failure",failure==null?JSONObject.NULL:failure).put("pollIntervalMs",25);
            result.putString("stream","PERFORMANCE_JSON "+report.toString()+"\n");
        }catch(Exception error){result.putString("stream","PERFORMANCE_FAILED "+error.getMessage()+"\n");failure=error.getMessage();}
        finish(failure==null?-1:1,result);
    }
}
