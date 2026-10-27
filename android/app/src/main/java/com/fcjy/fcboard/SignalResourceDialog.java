package com.fcjy.fcboard;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.media.tv.TvContentRating;
import android.media.tv.TvContract;
import android.media.tv.TvInputInfo;
import android.media.tv.TvInputManager;
import android.media.tv.TvView;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Real TIF passthrough inputs; proprietary source apps remain an explicit external fallback. */
final class SignalResourceDialog extends Dialog {
    private final Context text;
    private final TvInputManager manager;
    private final TvView television;
    private final Spinner selector;
    private final TextView status;
    private final List<TvInputInfo> inputs = new ArrayList<>();
    private String inputId;
    private String videoState = "closed";
    private boolean registered;
    private int displayWidth;
    private int displayHeight;
    private final View.OnLayoutChangeListener displayLayout =
        (view, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom) -> resizeToDisplay();
    private final TvInputManager.TvInputCallback inputChanges = new TvInputManager.TvInputCallback() {
        @Override public void onInputAdded(String id) { refreshInputs(); }
        @Override public void onInputRemoved(String id) { refreshInputs(); }
        @Override public void onInputUpdated(String id) { refreshInputs(); }
        @Override public void onInputStateChanged(String id, int state) {
            refreshInputs(id.equals(inputId));
        }
    };
    private final AdapterView.OnItemSelectedListener selection = new AdapterView.OnItemSelectedListener() {
        @Override public void onItemSelected(AdapterView<?> parent, View view, int position, long id) { tuneSelected(false); }
        @Override public void onNothingSelected(AdapterView<?> parent) { }
    };

    static List<TvInputInfo> availableInputs(Context context) {
        List<TvInputInfo> result = new ArrayList<>();
        TvInputManager manager = (TvInputManager) context.getSystemService(Context.TV_INPUT_SERVICE);
        if (manager == null) return result;
        try {
            for (TvInputInfo input : manager.getTvInputList()) {
                if (input.isPassthroughInput() && !input.isHidden(context)) result.add(input);
            }
        } catch (RuntimeException unavailable) {
            // Non-TV firmware can expose the service name without a usable TIF service.
            result.clear();
        }
        return result;
    }

    private static Context localized(Context context, String language) {
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.setLocale(Locale.forLanguageTag(language));
        return context.createConfigurationContext(config);
    }

    private static String inputLabel(Context context, TvInputInfo input, int index) {
        CharSequence label = null;
        try {
            label = input.loadCustomLabel(context);
            if (label == null || label.length() == 0) label = input.loadLabel(context);
        } catch (RuntimeException removed) { /* An input package can disappear after enumeration. */ }
        return label == null || label.length() == 0 ? context.getString(R.string.signal_input_number, index + 1) : label.toString();
    }

    private static JSObject describe(Context text, List<TvInputInfo> inputs, String selected, boolean open, String video, CharSequence message) {
        JSObject result = new JSObject();
        result.put("open", open);
        result.put("embedded", open);
        result.put("available", !inputs.isEmpty());
        result.put("video", video);
        result.put("message", message == null ? "" : message.toString());
        if (selected != null) result.put("selectedId", selected);
        TvInputManager manager = (TvInputManager) text.getSystemService(Context.TV_INPUT_SERVICE);
        JSArray values = new JSArray();
        for (int index = 0; index < inputs.size(); index++) {
            TvInputInfo input = inputs.get(index);
            String state = "unavailable";
            try {
                int value = manager == null ? -1 : manager.getInputState(input.getId());
                if (value == TvInputManager.INPUT_STATE_CONNECTED) state = "connected";
                else if (value == TvInputManager.INPUT_STATE_CONNECTED_STANDBY) state = "standby";
                else if (value == TvInputManager.INPUT_STATE_DISCONNECTED) state = "disconnected";
            } catch (RuntimeException removed) { /* Preserve the actual service failure. */ }
            JSObject item = new JSObject();
            item.put("id", input.getId());
            item.put("label", inputLabel(text, input, index));
            item.put("state", state);
            item.put("selected", input.getId().equals(selected));
            values.put(item);
        }
        result.put("inputs", values);
        return result;
    }

    static JSObject closedState(Context context, String language) {
        Context text = localized(context, language);
        return describe(text, availableInputs(context), null, false, "closed", text.getString(R.string.signal_control_unavailable));
    }

    private String selectedInput() {
        int index = selector.getSelectedItemPosition();
        return index >= 0 && index < inputs.size() ? inputs.get(index).getId() : null;
    }

    JSObject action(String action, String id) {
        if (!isShowing()) throw new IllegalStateException(text.getString(R.string.signal_control_unavailable));
        if ("close".equals(action)) {
            dismiss();
            return closedState(text, text.getResources().getConfiguration().getLocales().get(0).toLanguageTag());
        }
        if ("select".equals(action)) {
            boolean available = false;
            for (TvInputInfo input : availableInputs(getContext())) if (input.getId().equals(id)) available = true;
            if (!available) throw new IllegalArgumentException(text.getString(R.string.signal_input_unavailable));
            refreshInputs(false, false);
            int index = -1;
            for (int position = 0; position < inputs.size(); position++) if (inputs.get(position).getId().equals(id)) index = position;
            if (index < 0) throw new IllegalArgumentException(text.getString(R.string.signal_input_unavailable));
            selector.setSelection(index, false);
            tuneSelected(false);
        } else if ("reload".equals(action)) {
            refreshInputs(true);
        } else if ("reset".equals(action)) {
            releaseInput();
            showStatus(R.string.signal_no_video);
            videoState = "reset";
        } else if (!"read".equals(action)) {
            throw new IllegalArgumentException("Unknown signal source action");
        }
        JSObject result = describe(text, inputs, selectedInput(), true, videoState, status.getVisibility() == View.VISIBLE ? status.getText() : "");
        if (inputId != null) result.put("inputId", inputId);
        return result;
    }

    SignalResourceDialog(Activity activity, String language) {
        super(activity);
        text = localized(activity, language);
        manager = (TvInputManager) activity.getSystemService(Context.TV_INPUT_SERVICE);
        setOwnerActivity(activity);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setCanceledOnTouchOutside(false);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable surface = new GradientDrawable();
        surface.setColor(Color.WHITE);
        surface.setCornerRadius(dp(16));
        root.setBackground(surface);
        root.setClipToOutline(true);
        LinearLayout controls = new LinearLayout(activity);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(dp(12), dp(6), dp(8), dp(6));
        selector = new Spinner(activity);
        selector.setContentDescription(text.getString(R.string.signal_source));
        controls.addView(selector, new LinearLayout.LayoutParams(0, dp(48), 1));
        button(controls, R.drawable.factory_web_refresh, R.string.web_reload, () -> refreshInputs(true));
        button(controls, R.drawable.factory_web_close, R.string.web_close, this::dismiss);
        root.addView(controls);

        FrameLayout video = new FrameLayout(activity);
        video.setBackgroundColor(Color.BLACK);
        television = new TvView(activity);
        video.addView(television, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        status = new TextView(activity);
        status.setGravity(Gravity.CENTER);
        status.setTextColor(Color.WHITE);
        status.setTextSize(16);
        status.setPadding(dp(24), dp(24), dp(24), dp(24));
        video.addView(status, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(video, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(root);
        television.setCallback(new TvView.TvInputCallback() {
            @Override public void onVideoAvailable(String id) {
                if (id.equals(inputId)) { videoState = "available"; status.setVisibility(View.GONE); }
            }
            @Override public void onVideoUnavailable(String id, int reason) {
                if (id.equals(inputId)) showStatus(R.string.signal_no_video);
            }
            @Override public void onConnectionFailed(String id) {
                if (id.equals(inputId)) showStatus(R.string.signal_connection_failed);
            }
            @Override public void onDisconnected(String id) {
                if (id.equals(inputId)) showStatus(R.string.signal_connection_failed);
            }
            @Override public void onContentBlocked(String id, TvContentRating rating) {
                if (id.equals(inputId)) showStatus(R.string.signal_content_blocked);
            }
        });
        setOnDismissListener(dialog -> {
            activity.getWindow().getDecorView().removeOnLayoutChangeListener(displayLayout);
            if (registered && manager != null) {
                try { manager.unregisterCallback(inputChanges); }
                catch (RuntimeException disconnected) { /* The TV service can disappear with its input. */ }
                registered = false;
            }
            selector.setOnItemSelectedListener(null);
            television.setCallback(null);
            releaseInput();
            videoState = "closed";
        });
    }

    private int dp(int value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }

    private void button(LinearLayout row, int icon, int label, Runnable action) {
        ImageButton button = new ImageButton(getContext());
        button.setImageResource(icon);
        button.setContentDescription(text.getString(label));
        button.setBackgroundResource(android.R.drawable.list_selector_background);
        button.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        row.addView(button, new LinearLayout.LayoutParams(dp(44), dp(44)));
        button.setOnClickListener(view -> action.run());
    }

    private void showStatus(int message) {
        if (message == R.string.signal_connecting) videoState = "connecting";
        else if (message == R.string.signal_no_video) videoState = "unavailable";
        else if (message == R.string.signal_connection_failed) videoState = "failed";
        else if (message == R.string.signal_content_blocked) videoState = "blocked";
        else videoState = "unavailable";
        status.setText(text.getString(message));
        status.setVisibility(View.VISIBLE);
    }

    private void releaseInput() {
        inputId = null;
        try { television.setStreamVolume(0); television.reset(); }
        catch (RuntimeException disconnected) { /* The service may have died while closing. */ }
    }

    private void refreshInputs() {
        refreshInputs(false);
    }

    private void refreshInputs(boolean force) {
        refreshInputs(force, true);
    }

    private void refreshInputs(boolean force, boolean tune) {
        if (!isShowing()) return;
        String previous = selectedInput();
        inputs.clear();
        inputs.addAll(availableInputs(getContext()));
        selector.setOnItemSelectedListener(null);
        List<String> labels = new ArrayList<>();
        int selected = 0;
        for (int index = 0; index < inputs.size(); index++) {
            TvInputInfo input = inputs.get(index);
            labels.add(inputLabel(text, input, index));
            if (input.getId().equals(previous)) selected = index;
        }
        ArrayAdapter<String> adapter = new ArrayAdapter<>(getContext(), android.R.layout.simple_spinner_item, labels);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        selector.setAdapter(adapter);
        selector.setEnabled(!inputs.isEmpty());
        if (inputs.isEmpty()) {
            releaseInput();
            showStatus(R.string.signal_unavailable);
            return;
        }
        selector.setSelection(selected, false);
        selector.setOnItemSelectedListener(selection);
        if (tune) tuneSelected(force);
    }

    private void tuneSelected(boolean force) {
        int index = selector.getSelectedItemPosition();
        if (!isShowing() || index < 0 || index >= inputs.size() || manager == null) return;
        TvInputInfo input = inputs.get(index);
        if (!force && input.getId().equals(inputId)) return;
        releaseInput();
        inputId = input.getId();
        try {
            if (manager.getInputState(inputId) == TvInputManager.INPUT_STATE_DISCONNECTED) {
                showStatus(R.string.signal_no_video);
                return;
            }
            showStatus(R.string.signal_connecting);
            television.setStreamVolume(1);
            television.tune(inputId, TvContract.buildChannelUriForPassthroughInput(inputId));
        } catch (RuntimeException failure) {
            releaseInput();
            showStatus(R.string.signal_connection_failed);
        }
    }

    @Override public void show() {
        super.show();
        if (getWindow() == null) return;
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        getWindow().setGravity(Gravity.CENTER);
        getOwnerActivity().getWindow().getDecorView().addOnLayoutChangeListener(displayLayout);
        resizeToDisplay();
        if (manager != null) {
            try {
                manager.registerCallback(inputChanges, new Handler(Looper.getMainLooper()));
                registered = true;
            } catch (RuntimeException unavailable) { registered = false; }
        }
        refreshInputs();
    }

    private void resizeToDisplay() {
        if (!isShowing() || getWindow() == null) return;
        Rect bounds = new Rect();
        getOwnerActivity().getWindow().getDecorView().getWindowVisibleDisplayFrame(bounds);
        if (bounds.width() <= 0 || bounds.height() <= 0) bounds.set(0, 0, getContext().getResources().getDisplayMetrics().widthPixels, getContext().getResources().getDisplayMetrics().heightPixels);
        if (displayWidth == bounds.width() && displayHeight == bounds.height()) return;
        displayWidth = bounds.width();
        displayHeight = bounds.height();
        getWindow().setLayout(Math.min(dp(960), (int) (displayWidth * 0.9)), Math.min(dp(640), (int) (displayHeight * 0.82)));
    }
}
