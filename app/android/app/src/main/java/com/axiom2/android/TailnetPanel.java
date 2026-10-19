package com.axiom2.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowManager;
import android.widget.*;
import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Optional, native-only inventory chooser. It never authenticates the remote WebView. */
final class TailnetPanel extends LinearLayout implements AutoCloseable {
    private static final int FG = 0xfff7f8f8, MUTED = 0xff969ca6, ERROR = 0xfffca5a5, PAGE_SIZE = 10;
    private final Activity activity;
    private final Consumer<String> selection;
    private final TailnetApi api;
    private final TailnetCredentialStore store;
    private final ThreadPoolExecutor io = (ThreadPoolExecutor) Executors.newFixedThreadPool(2);
    private final ThreadPoolExecutor probes = (ThreadPoolExecutor) Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Button toggle, refresh, configure, cancel, previous, next;
    private final LinearLayout content, rows;
    private final EditText search;
    private final TextView message, pageLabel;
    private final List<Future<?>> probeJobs = new ArrayList<>();
    private Future<?> loading;
    private TailnetApi.Cancel loadCancel = new TailnetApi.Cancel(), probeCancel = new TailnetApi.Cancel();
    private TailnetApi.Credentials credentials;
    private List<TailnetApi.Device> devices = Collections.emptyList();
    private int generation, probeGeneration, page;
    private boolean expanded, busy, disposed, available = true, paused;
    private AlertDialog dialog, removalDialog;
    private Runnable searchPending;

    TailnetPanel(Activity activity, Consumer<String> selection) { this(activity, selection, new TailnetApi()); }
    TailnetPanel(Activity activity, Consumer<String> selection, TailnetApi api) {
        super(activity); this.activity = activity; this.selection = selection; this.api = api; store = new TailnetCredentialStore(activity);
        setOrientation(VERTICAL);
        toggle = button("选择 Tailscale 设备"); add(this, toggle, 0);
        content = column(); content.setVisibility(GONE); add(this, content, 8);
        message = text("配置只读凭据后，可按设备名称选择电脑。", MUTED); message.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_POLITE); add(content, message, 0);
        LinearLayout actions = new LinearLayout(activity);
        refresh = button("刷新设备"); configure = button("配置设备发现"); pair(actions, refresh, configure); add(content, actions, 8);
        cancel = button("取消加载"); cancel.setVisibility(GONE); add(content, cancel, 8);
        search = field("搜索设备名或 IP", InputType.TYPE_CLASS_TEXT); search.setContentDescription("搜索 Tailscale 设备名或 IP"); add(content, search, 8);
        rows = column(); add(content, rows, 8);
        pageLabel = text("", MUTED); add(content, pageLabel, 8);
        LinearLayout paging = new LinearLayout(activity);
        previous = button("上一页"); next = button("下一页"); pair(paging, previous, next); add(content, paging, 8);
        add(content, text("设备清单来自 Tailscale 管理 API。服务检查使用配置端口；进入工作台时还会确认实时连接。手机 VPN 应与凭据属于同一 Tailnet。", MUTED), 12);
        toggle.setOnClickListener(v -> { if (expanded) collapse(); else { expanded = true; content.setVisibility(VISIBLE); toggle.setText("收起 Tailscale 设备"); loadSaved(); } });
        refresh.setOnClickListener(v -> loadSaved()); configure.setOnClickListener(v -> configure());
        cancel.setOnClickListener(v -> { stopWork(); devices = Collections.emptyList(); clearRows(); show("已取消，可刷新设备或手动连接。", false); });
        previous.setOnClickListener(v -> { page--; renderPage(); }); next.setOnClickListener(v -> { page++; renderPage(); });
        search.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                cancelProbes(); page = 0;
                if (searchPending != null) main.removeCallbacks(searchPending);
                searchPending = () -> { if (usable() && expanded && !busy) renderPage(); };
                main.postDelayed(searchPending, 250);
            }
            public void afterTextChanged(Editable value) { }
        });
        clearRows();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private LinearLayout column() { LinearLayout layout = new LinearLayout(activity); layout.setOrientation(VERTICAL); return layout; }
    private TextView text(String value, int color) {
        TextView view = new TextView(activity); view.setText(value); view.setTextColor(color); view.setTextSize(14); view.setLineSpacing(dp(3), 1); return view;
    }
    private Button button(String value) {
        Button button = new Button(activity); button.setText(value); button.setAllCaps(false); button.setTextSize(14); button.setMinHeight(dp(48)); button.setMinimumWidth(0); button.setMinWidth(0); button.setPadding(dp(12), dp(10), dp(12), dp(10));
        button.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled}, new int[]{}}, new int[]{MUTED, FG}));
        GradientDrawable shape = new GradientDrawable(); shape.setColor(0xff191a1b); shape.setCornerRadius(dp(12)); shape.setStroke(dp(1), 0xff303235);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x44f0995b), shape, null)); return button;
    }
    private EditText field(String hint, int input) {
        EditText view = new EditText(activity); view.setId(View.generateViewId()); view.setTextColor(FG); view.setHintTextColor(MUTED); view.setTextSize(16); view.setSingleLine(true); view.setMinHeight(dp(48)); view.setInputType(input); view.setHint(hint); view.setSaveEnabled(false); return view;
    }
    private void add(LinearLayout parent, View view, int gap) { LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.topMargin = dp(gap); parent.addView(view, params); }
    private void pair(LinearLayout parent, View first, View second) {
        parent.addView(first, new LinearLayout.LayoutParams(0, -2, 1));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, -2, 1); params.leftMargin = dp(8); parent.addView(second, params);
    }
    private void label(LinearLayout parent, String name, EditText input) { TextView label = text(name, MUTED); label.setLabelFor(input.getId()); add(parent, label, 12); add(parent, input, 0); }
    private boolean usable() { return !disposed && !paused && available; }
    private boolean owns(int owned) { return usable() && expanded && generation == owned; }
    private void show(String value, boolean error) { message.setText(value); message.setTextColor(error ? ERROR : MUTED); }
    private void setBusy(boolean value) { busy = value; refresh.setEnabled(!value); configure.setEnabled(!value); search.setEnabled(!value); cancel.setVisibility(value ? VISIBLE : GONE); }
    private void clearRows() { rows.removeAllViews(); pageLabel.setText(""); previous.setVisibility(GONE); next.setVisibility(GONE); }
    private void cancelProbes() {
        probeGeneration++; probeCancel.cancel(); probeCancel = new TailnetApi.Cancel();
        for (Future<?> job : probeJobs) job.cancel(true); probeJobs.clear(); probes.purge();
    }
    private void stopWork() {
        generation++; loadCancel.cancel(); loadCancel = new TailnetApi.Cancel();
        if (loading != null) loading.cancel(true); loading = null; io.purge(); cancelProbes(); setBusy(false);
        if (searchPending != null) main.removeCallbacks(searchPending);
    }
    private void collapse() { stopWork(); expanded = false; content.setVisibility(GONE); toggle.setText("选择 Tailscale 设备"); toggle.requestFocus(); }
    private void loadSaved() {
        if (!usable() || !expanded) return;
        stopWork(); int owned = generation; setBusy(true); clearRows(); devices = Collections.emptyList(); show("正在读取设备配置…", false);
        armDeadline(owned);
        loading = TailnetCredentialStore.SERIAL.submit(() -> {
            try {
                TailnetApi.Credentials saved = store.load();
                main.post(() -> {
                    if (!owns(owned)) return;
                    credentials = saved;
                    if (saved == null) { setBusy(false); show("尚未配置设备发现。可配置只读凭据，也可继续手动连接。", false); }
                    else fetch(saved, owned);
                });
            } catch (IOException e) { main.post(() -> { if (owns(owned)) { credentials = null; setBusy(false); show(e.getMessage(), true); } }); }
        });
    }
    private void fetch(TailnetApi.Credentials saved, int owned) {
        show("正在从 Tailscale 加载设备…", false); TailnetApi.Cancel operation = loadCancel;
        loading = io.submit(() -> {
            try {
                List<TailnetApi.Device> result = api.devices(saved, operation);
                main.post(() -> {
                    if (!owns(owned)) return;
                    devices = result; page = 0; setBusy(false);
                    show(result.isEmpty() ? "此 Tailnet 没有设备。可检查配置或继续手动连接。" : "已加载 " + result.size() + " 台设备 · 检查服务端口 " + saved.port, false); renderPage();
                });
            } catch (Exception e) { main.post(() -> { if (owns(owned)) { setBusy(false); show(TailnetApi.failure(e), true); } }); }
        });
    }
    private void armDeadline(int owned) {
        // Covers queueing, storage, DNS and HTTP, including old requests that ignore interruption.
        main.postDelayed(() -> { if (owns(owned) && busy) { stopWork(); show("操作超时，请刷新读取最新配置与设备。手动连接仍可使用。", true); } }, 22000);
    }
    private void renderPage() {
        cancelProbes(); clearRows(); if (!usable() || credentials == null) return;
        String query = search.getText().toString().trim().toLowerCase(Locale.ROOT);
        List<TailnetApi.Device> filtered = new ArrayList<>();
        for (TailnetApi.Device device : devices) if (device.name.toLowerCase(Locale.ROOT).contains(query) || device.addresses.toString().toLowerCase(Locale.ROOT).contains(query)) filtered.add(device);
        if (filtered.isEmpty()) { if (!devices.isEmpty()) pageLabel.setText("没有匹配设备，试试其他名称或 IP。"); return; }
        int pages = (filtered.size() + PAGE_SIZE - 1) / PAGE_SIZE; page = Math.max(0, Math.min(page, pages - 1));
        pageLabel.setText("第 " + (page + 1) + " / " + pages + " 页 · " + filtered.size() + " 台设备");
        previous.setVisibility(pages > 1 ? VISIBLE : GONE); next.setVisibility(pages > 1 ? VISIBLE : GONE); previous.setEnabled(page > 0); next.setEnabled(page + 1 < pages);
        int owned = generation, probeOwned = probeGeneration, port = credentials.port; TailnetApi.Cancel operation = probeCancel;
        for (int i = page * PAGE_SIZE; i < Math.min(filtered.size(), (page + 1) * PAGE_SIZE); i++) {
            TailnetApi.Device device = filtered.get(i);
            String[] endpoint = {device.addresses.isEmpty() ? "" : device.endpoint(device.addresses.get(0), port)};
            String cloud = device.connectedToControl == null ? "Tailscale 状态未知" : device.connectedToControl ? "Tailscale 在线（云端）" : "Tailscale 离线（云端）";
            Button row = button(device.name + "\n" + endpoint[0] + "\n" + cloud + " · 正在检查服务…"); row.setGravity(android.view.Gravity.START | android.view.Gravity.CENTER_VERTICAL); row.setEnabled(!endpoint[0].isEmpty()); add(rows, row, 8);
            row.setOnClickListener(v -> { if (!usable() || !expanded) return; String value = endpoint[0]; collapse(); selection.accept(value); });
            probeJobs.add(probes.submit(() -> {
                try {
                    TailnetApi.Probe result = api.probe(device, port, operation);
                    main.post(() -> { if (owns(owned) && probeGeneration == probeOwned) { endpoint[0] = result.endpoint; row.setText(device.name + "\n" + result.endpoint + "\n" + cloud + "\n" + result.label); } });
                } catch (IOException ignored) { /* cancelled pages must never repaint new rows */ }
            }));
        }
    }
    private void configure() {
        stopWork();
        LinearLayout form = column(); form.setPadding(dp(20), dp(8), dp(20), dp(12)); form.setImportantForAutofill(IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        TextView help = text("由 Tailnet 管理员创建仅有 devices:core:read 权限的 OAuth client。凭据只用于设备列表，以 Android Keystore 加密保存在本机。", MUTED); add(form, help, 0);
        EditText tailnet = field("-（使用凭据所属 Tailnet）", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        EditText clientId = field("OAuth client ID", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        EditText secret = field(credentials == null ? "OAuth client secret" : "已保存；留空保留", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        EditText port = field("4317", InputType.TYPE_CLASS_NUMBER);
        TailnetApi.Credentials saved = credentials;
        tailnet.setText(saved == null ? "-" : saved.tailnet); clientId.setText(saved == null ? "" : saved.clientId); port.setText(Integer.toString(saved == null ? 4317 : saved.port));
        label(form, "Tailnet", tailnet); label(form, "Client ID", clientId); label(form, "Client secret", secret); label(form, "Axiom 服务端口", port);
        CheckBox reveal = new CheckBox(activity); reveal.setText("显示本次输入的 secret"); reveal.setTextColor(FG); reveal.setMinHeight(dp(48)); add(form, reveal, 8);
        reveal.setOnCheckedChangeListener((view, checked) -> { secret.setInputType(InputType.TYPE_CLASS_TEXT | (checked ? InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD : InputType.TYPE_TEXT_VARIATION_PASSWORD)); secret.setSelection(secret.length()); });
        TextView error = text("", ERROR); error.setAccessibilityLiveRegion(ACCESSIBILITY_LIVE_REGION_ASSERTIVE); add(form, error, 8);
        Button guide = button("查看只读凭据设置说明"); add(form, guide, 8);
        guide.setOnClickListener(v -> { try { activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://tailscale.com/kb/1215/oauth-clients"))); } catch (Exception e) { error.setText("请在浏览器打开 tailscale.com/kb/1215/oauth-clients。"); } });
        ScrollView scroll = new ScrollView(activity); scroll.addView(form);
        AlertDialog current = new AlertDialog.Builder(activity).setTitle("配置 Tailscale 设备发现").setView(scroll)
                .setPositiveButton("保存并加载", null).setNegativeButton("取消", null).setNeutralButton("移除配置", null).create();
        dialog = current; current.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        current.setOnDismissListener(d -> { secret.setText(""); if (dialog == current) dialog = null; configure.requestFocus(); });
        current.setOnShowListener(d -> {
            current.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                try {
                    String entered = secret.getText().toString(); String id = clientId.getText().toString().trim();
                    if (entered.trim().isEmpty() && saved != null && saved.clientId.equals(id)) entered = saved.secret;
                    int number;
                    try { number = Integer.parseInt(port.getText().toString().trim()); } catch (NumberFormatException e) { port.setError("端口应为 1–65535"); port.requestFocus(); return; }
                    TailnetApi.Credentials replacement = new TailnetApi.Credentials(tailnet.getText().toString(), id, entered, number);
                    current.dismiss(); persist(replacement);
                } catch (IOException e) { error.setText(e.getMessage()); }
            });
            current.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                removalDialog = new AlertDialog.Builder(activity).setTitle("移除设备发现配置？")
                    .setMessage("将删除本机保存的凭据和当前设备列表，保留手动地址与成功连接历史。")
                    .setNegativeButton("保留", null).setPositiveButton("移除", (confirm, which) -> { current.dismiss(); persist(null); }).create();
                removalDialog.setOnDismissListener(ignored -> removalDialog = null);
                removalDialog.show();
            });
        });
        current.show();
    }
    private void persist(TailnetApi.Credentials replacement) {
        stopWork(); int owned = generation; clearRows(); devices = Collections.emptyList(); setBusy(true); show(replacement == null ? "正在移除配置…" : "正在加密保存凭据…", false);
        // Serialize durable changes with reads. Once explicitly saved, a background transition does not undo it.
        armDeadline(owned);
        TailnetCredentialStore.SERIAL.execute(() -> {
            try {
                if (replacement == null) store.clear(); else store.save(replacement);
                main.post(() -> { if (owns(owned)) { credentials = replacement; if (replacement == null) { setBusy(false); show("设备发现配置已移除。手动地址与历史仍可使用。", false); } else fetch(replacement, owned); } });
            } catch (IOException e) { main.post(() -> { if (owns(owned)) { setBusy(false); show(e.getMessage(), true); } }); }
        });
    }
    private void dismissDialogs() { if (removalDialog != null) removalDialog.dismiss(); if (dialog != null) dialog.dismiss(); }
    void setAvailable(boolean value) {
        available = value; setVisibility(value ? VISIBLE : GONE);
        if (!value) { stopWork(); dismissDialogs(); }
        else if (expanded && !paused) loadSaved();
    }
    boolean back() { if (!expanded || !available) return false; collapse(); return true; }
    void pause() {
        paused = true; stopWork(); credentials = null; devices = Collections.emptyList(); clearRows();
        if (expanded) show("返回后刷新设备状态。", false);
        dismissDialogs();
    }
    void resume() { paused = false; if (available && expanded) loadSaved(); }
    @Override public void close() { disposed = true; stopWork(); dismissDialogs(); main.removeCallbacksAndMessages(null); io.shutdownNow(); probes.shutdownNow(); api.close(); credentials = null; }
}
