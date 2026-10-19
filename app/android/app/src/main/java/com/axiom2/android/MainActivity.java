package com.axiom2.android;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import android.webkit.*;
import com.axiom.sdk.AxiomWebView;

/** Native connection chooser; projects and execution stay on the selected computer. */
public class MainActivity extends Activity {
    private final int bg = 0xff08090a, muted = 0xff969ca6, fg = 0xfff7f8f8, accent = 0xfff0995b;
    private FrameLayout root;
    private ScrollView status;
    private AxiomWebView web;
    private TailnetPanel tailnet;
    private TextView feedback, retry, vpn, cancel;
    private AutoCompleteTextView address;
    private String connectingAddress = "";
    private ProgressBar progress;
    private boolean connecting, loaded, scanPending;
    private TextView scan;
    private ValueCallback<Uri[]> upload;
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) { TextView t = new TextView(this); t.setText(value); t.setTextSize(size); t.setTextColor(color); t.setLineSpacing(dp(3), 1); return t; }
    private void add(LinearLayout parent, View child, int top) { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.topMargin = dp(top); parent.addView(child, p); }
    private TextView button(String label) {
        TextView t = text(label, 15, fg); t.setGravity(android.view.Gravity.CENTER); t.setMinHeight(dp(52)); t.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable shape = new GradientDrawable(); shape.setColor(0xff191a1b); shape.setCornerRadius(dp(14)); shape.setStroke(dp(1), 0xff303235); t.setBackground(shape); t.setClickable(true); t.setFocusable(true); return t;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        scanPending = state != null && state.getBoolean("scanPending");
        getWindow().setStatusBarColor(bg); getWindow().setNavigationBarColor(bg); getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        root = new FrameLayout(this); root.setBackgroundColor(bg); root.setFitsSystemWindows(true); setContentView(root);
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false); root.setFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((view, insets) -> { android.graphics.Insets cutout = insets.getInsets(android.view.WindowInsets.Type.displayCutout()); android.graphics.Insets ime = insets.getInsets(android.view.WindowInsets.Type.ime()); view.setPadding(cutout.left, cutout.top, cutout.right, Math.max(cutout.bottom, ime.bottom)); return android.view.WindowInsets.CONSUMED; });
        }
        enterFullscreen();
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web = new AxiomWebView(this); root.addView(web, new FrameLayout.LayoutParams(-1, -1)); web.setVisibility(View.GONE);
        web.setListener(new AxiomWebView.Listener() {
            public void onReady() { if (!connecting) return; loaded = true; connecting = false; saveConnection(); status.setVisibility(View.GONE); web.setVisibility(View.VISIBLE); }
            public void onError(String message) { showError(message); }
            public void onRendererGone() { loaded = false; recreate(); }
            public void onExternalLink(Uri uri) { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception e) { Toast.makeText(MainActivity.this, "没有可打开此链接的浏览器。", Toast.LENGTH_LONG).show(); } }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (upload != null) upload.onReceiveValue(null); upload = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType("*/*"); intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try { startActivityForResult(intent, 41); } catch (Exception e) { upload.onReceiveValue(null); upload = null; Toast.makeText(MainActivity.this, "系统文件选择器不可用。", Toast.LENGTH_LONG).show(); }
                return true;
            }
        });
        status = new ScrollView(this); status.setFillViewport(true); status.setBackgroundColor(bg); root.addView(status, new FrameLayout.LayoutParams(-1, -1));
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setGravity(android.view.Gravity.CENTER_VERTICAL); page.setPadding(dp(28), dp(36), dp(28), dp(36)); status.addView(page, new ScrollView.LayoutParams(-1, -2));
        LinearLayout brandRow = new LinearLayout(this); brandRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
        ImageView mark = new ImageView(this); mark.setImageResource(R.drawable.ic_launcher); mark.setScaleType(ImageView.ScaleType.FIT_CENTER); mark.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); brandRow.addView(mark, new LinearLayout.LayoutParams(dp(40), dp(40)));
        TextView brand = text("AXIOM  /  MOBILE", 12, accent); brand.setLetterSpacing(.18f); LinearLayout.LayoutParams brandLabel = new LinearLayout.LayoutParams(-2, -2); brandLabel.leftMargin = dp(12); brandRow.addView(brand, brandLabel); add(page, brandRow, 0);
        TextView title = text("接续你的工作。", 30, fg); title.setTypeface(null, Typeface.BOLD); add(page, title, 24);
        feedback = text("扫描电脑上的连接二维码，或输入 Tailscale 地址。", 15, muted); feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); add(page, feedback, 16);
        scan = button("扫码连接"); scan.setTextColor(accent); scan.setOnClickListener(v -> {
            if (connecting || scanPending) return;
            scanPending = true;
            try { startActivityForResult(new Intent(this, QrScanActivity.class), 42); }
            catch (Exception e) { scanPending = false; feedback.setText("无法打开扫码页面，请手动输入地址。"); }
        }); add(page, scan, 20);
        tailnet = new TailnetPanel(this, endpoint -> { address.setText(endpoint); address.dismissDropDown(); feedback.setTextColor(muted); feedback.setText("已选择设备，点击连接工作台。"); retry.requestFocus(); }); add(page, tailnet, 20);
        TextView addressLabel = text("连接地址", 12, muted); add(page, addressLabel, 24);
        address = new AutoCompleteTextView(this); address.setId(View.generateViewId()); addressLabel.setLabelFor(address.getId()); address.setTextColor(fg); address.setHintTextColor(muted); address.setTextSize(16); address.setSingleLine(true); address.setMinHeight(dp(52)); address.setHint("100.x.x.x:4317"); address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); address.setThreshold(0);
        address.setText(getSharedPreferences("connection", MODE_PRIVATE).getString("last", "")); updateHistory(); address.setOnFocusChangeListener((v, focused) -> { if (focused) address.showDropDown(); }); address.setOnClickListener(v -> address.showDropDown()); add(page, address, 8);
        address.setOnItemClickListener((parent, view, position, id) -> begin());
        progress = new ProgressBar(this); progress.setVisibility(View.GONE); LinearLayout.LayoutParams spinner = new LinearLayout.LayoutParams(dp(28), dp(28)); spinner.topMargin = dp(24); page.addView(progress, spinner);
        retry = button("连接工作台"); retry.setOnClickListener(v -> begin()); add(page, retry, 24);
        cancel = button("取消连接"); cancel.setVisibility(View.GONE); cancel.setOnClickListener(v -> { web.cancelConnect(); showError("已取消，可以重新选择地址。"); }); add(page, cancel, 8);
        vpn = button("打开 Tailscale"); vpn.setOnClickListener(v -> {
            Intent intent = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
            try { startActivity(intent != null ? intent : new Intent(Intent.ACTION_VIEW, Uri.parse("https://tailscale.com/download/android"))); } catch (Exception e) { feedback.setText("请连接手机上的 Tailscale。"); }
        }); add(page, vpn, 12);
        add(page, text("手机与电脑需连接 Tailscale。电脑 Axiom 的「配置 → 手机连接」可显示二维码；成功连接后，地址会保留在下拉历史中。", 12, muted), 20);
    }
    private void enterFullscreen() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(android.view.WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused); if (focused) enterFullscreen(); }
    private void begin() {
        if (connecting) return;
        try { connectingAddress = AxiomWebView.normalizeAddress(address.getText().toString()); } catch (Exception e) { showError(e.getMessage()); return; }
        connecting = true; loaded = false; scan.setVisibility(View.GONE); address.setEnabled(false); tailnet.setAvailable(false); web.setVisibility(View.GONE); status.setVisibility(View.VISIBLE);
        progress.setVisibility(View.VISIBLE); retry.setVisibility(View.GONE); vpn.setVisibility(View.GONE); cancel.setVisibility(View.VISIBLE); feedback.setTextColor(muted); feedback.setText("正在连接 " + connectingAddress + "…");
        web.connect(connectingAddress);
    }
    private void showError(String message) {
        connecting = false; if (status == null) return;
        status.setVisibility(View.VISIBLE); scan.setVisibility(View.VISIBLE); web.setVisibility(View.GONE); address.setEnabled(true); tailnet.setAvailable(true); progress.setVisibility(View.GONE); retry.setVisibility(View.VISIBLE); vpn.setVisibility(View.VISIBLE); cancel.setVisibility(View.GONE); feedback.setTextColor(0xffe6ac94); feedback.setText(message);
    }
    private void updateHistory() {
        String saved = getSharedPreferences("connection", MODE_PRIVATE).getString("history", "");
        address.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_dropdown_item_1line, saved.isEmpty() ? new String[0] : saved.split("\\n")));
    }
    private void saveConnection() {
        java.util.LinkedHashSet<String> history = new java.util.LinkedHashSet<>(); history.add(connectingAddress);
        String saved = getSharedPreferences("connection", MODE_PRIVATE).getString("history", "");
        for (String entry : saved.split("\\n")) if (!entry.isEmpty() && history.size() < 8) history.add(entry);
        getSharedPreferences("connection", MODE_PRIVATE).edit().putString("last", connectingAddress).putString("history", android.text.TextUtils.join("\n", history)).apply();
        updateHistory();
    }
    @Override public void onBackPressed() {
        if (status.getVisibility() == View.VISIBLE) { if (tailnet.back()) return; web.cancelConnect(); connecting = false; super.onBackPressed(); return; }
        web.evaluateJavascript("(()=>{try{const p=document.querySelector('[popover]:popover-open');if(p){p.hidePopover();return true}}catch(e){}const ds=document.querySelectorAll('dialog[open]:not([popover])');const d=ds[ds.length-1];if(d){const event=new Event('cancel',{cancelable:true});if(d.dispatchEvent(event)&&d.open)d.close();return true}const h=document.querySelector('.history-open #collapse-history');if(h){h.click();return true}return false})()", result -> {
            if ("true".equals(result)) return;
            if (web.canGoBack()) web.goBack(); else new android.app.AlertDialog.Builder(this).setTitle("工作台连接").setMessage("切换电脑会离开当前工作台，后台任务继续运行。").setPositiveButton("切换连接", (d, which) -> { web.cancelConnect(); loaded = false; showError("选择或输入连接地址。"); }).setNegativeButton("留在工作台", null).setNeutralButton("返回后台", (d, which) -> moveTaskToBack(true)).show();
        });
    }
    @Override protected void onSaveInstanceState(Bundle state) { state.putBoolean("scanPending", scanPending); super.onSaveInstanceState(state); }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 42) {
            boolean expected = scanPending; scanPending = false;
            if (expected && !connecting && status.getVisibility() == View.VISIBLE && resultCode == RESULT_OK && data != null) {
                try { address.setText(ConnectionQr.address(data.getStringExtra(QrScanActivity.ADDRESS))); address.dismissDropDown(); begin(); }
                catch (IllegalArgumentException invalid) { showError(invalid.getMessage()); }
            }
        }
        if (requestCode == 41 && upload != null) { upload.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data)); upload = null; }
    }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); if (tailnet != null) tailnet.resume(); }
    @Override protected void onPause() { if (tailnet != null) tailnet.pause(); if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { if (tailnet != null) tailnet.close(); if (upload != null) upload.onReceiveValue(null); root.removeView(web); web.destroy(); super.onDestroy(); }
}
