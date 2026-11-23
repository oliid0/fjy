package com.fcjy.fcboard;

import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.SeekBar;
import android.widget.TextView;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.JSObject;
import java.util.Locale;

/** The movable player stays above the board and leaves the surrounding board interactive. */
@UnstableApi
final class MediaWindow {
    private static final int SEEK_STEPS = 10_000;
    private static final float[] SPEEDS = {.25f, .5f, .75f, 1, 1.25f, 1.5f, 2, 2.5f, 3};

    private final Activity activity;
    private final Dialog dialog;
    private final FrameLayout root;
    private final PlayerView video;
    private final LinearLayout header;
    private final LinearLayout controls;
    private final LinearLayout enhancement;
    private final TextView title;
    private final TextView time;
    private final TextView status;
    private final TextView error;
    private final TextView boost;
    private final SeekBar progress;
    private final SeekBar strength;
    private final Button previous;
    private final Button play;
    private final Button next;
    private final Button speed;
    private final Button enhance;
    private final Button fullscreen;
    private final Button resize;
    private final Player player;
    private final VoiceEnhancementProcessor processor;
    private final JSObject labels;
    private final String[] levels;
    private final View board;
    private final View.OnLayoutChangeListener boardLayout = (view, l, t, r, b, oldL, oldT, oldR, oldB) -> layout();
    private final Runnable hide = () -> setControlsVisible(false);
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            updateProgress();
            if (player.isPlaying()) root.postDelayed(this, 250);
        }
    };

    private final java.util.function.Consumer<JSObject> movedWindow;
    private float cssScale = 1;
    private boolean visual;
    private boolean expanded;
    private boolean seekDragging;
    private boolean seekingStrength;
    private boolean controlsVisible = true;
    private boolean hasAudio = true;
    private int barsToRestore;
    private PlaybackParameters beforeBoost;
    private int left;
    private int top;
    private int width;
    private int height;

    MediaWindow(Activity activity, Player player, VoiceEnhancementProcessor processor,
                JSObject labels, Runnable close, java.util.function.Consumer<JSObject> movedWindow) {
        this.movedWindow = movedWindow;
        this.activity = activity;
        this.player = player;
        this.processor = processor;
        this.labels = labels;
        board = activity.findViewById(android.R.id.content);
        levels = new String[]{label("off", "Off"), label("low", "Low"),
            label("medium", "Medium"), label("high", "High")};

        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCanceledOnTouchOutside(false);
        root = new FrameLayout(activity);
        root.setBackgroundColor(0xff151619);
        video = new PlayerView(activity);
        video.setUseController(false);
        video.setPlayer(player);
        root.addView(video, new FrameLayout.LayoutParams(-1, -1));
        bindVideoGestures();

        header = row();
        header.setBackgroundColor(0xdd222328);
        title = text();
        title.setSingleLine(true);
        title.setEllipsize(android.text.TextUtils.TruncateAt.END);
        title.setPadding(dp(12), 0, dp(8), 0);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        title.setOnTouchListener(windowDrag(false));
        header.addView(button("×", label("close", "Close"), close));
        root.addView(header, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));

        controls = column();
        controls.setBackgroundColor(0xdd222328);
        root.addView(controls, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        enhancement = column();
        enhancement.setPadding(dp(12), dp(3), dp(12), 0);
        controls.addView(enhancement);
        enhancement.setVisibility(View.GONE);
        strength = new SeekBar(activity);
        strength.setMax(levels.length - 1);
        strength.setContentDescription(label("enhance", "Voice enhancement"));
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(Color.WHITE);
        dot.setSize(dp(4), dp(4));
        strength.setTickMark(dot);
        enhancement.addView(strength, new LinearLayout.LayoutParams(-1, dp(36)));
        LinearLayout ticks = row();
        for (String level : levels) {
            TextView name = text();
            name.setText(level);
            name.setGravity(Gravity.CENTER);
            ticks.addView(name, new LinearLayout.LayoutParams(0, -2, 1));
        }
        enhancement.addView(ticks);
        status = text();
        status.setGravity(Gravity.CENTER);
        enhancement.addView(status, new LinearLayout.LayoutParams(-1, -2));
        strength.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(SeekBar bar) {
                seekingStrength = true;
                root.removeCallbacks(hide);
            }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                seekingStrength = false;
                scheduleHide();
            }
            @Override public void onProgressChanged(SeekBar bar, int value, boolean user) {
                if (user) {
                    processor.setLevel(value);
                    updateEnhancement();
                    scheduleHide();
                }
            }
        });

        LinearLayout timeline = row();
        timeline.setPadding(dp(6), 0, dp(9), 0);
        progress = new SeekBar(activity);
        progress.setContentDescription(label("seek", "Playback position"));
        progress.setMax(SEEK_STEPS);
        timeline.addView(progress, new LinearLayout.LayoutParams(0, dp(36), 1));
        time = text();
        time.setTextSize(12);
        timeline.addView(time);
        controls.addView(timeline);
        progress.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onStartTrackingTouch(SeekBar bar) {
                seekDragging = true;
                root.removeCallbacks(hide);
            }
            @Override public void onProgressChanged(SeekBar bar, int value, boolean user) {
                if (user && player.getDuration() > 0) {
                    long position = player.getDuration() * value / SEEK_STEPS;
                    if (seekDragging) showTime(position);
                    else player.seekTo(position);
                }
            }
            @Override public void onStopTrackingTouch(SeekBar bar) {
                seekDragging = false;
                if (player.getDuration() > 0) player.seekTo(player.getDuration() * bar.getProgress() / SEEK_STEPS);
                scheduleHide();
            }
        });

        HorizontalScrollView scroll = new HorizontalScrollView(activity);
        scroll.setHorizontalScrollBarEnabled(false);
        scroll.setFillViewport(true);
        controls.addView(scroll);
        LinearLayout buttons = row();
        buttons.setGravity(Gravity.CENTER);
        scroll.addView(buttons);
        previous = button("⏮", label("previous", "Previous track"), () -> moveTrack(false));
        play = button("▶", label("play", "Play"), this::togglePlayback);
        next = button("⏭", label("next", "Next track"), () -> moveTrack(true));
        speed = button("1×", label("speed", "Playback speed"), this::chooseSpeed);
        enhance = button(label("enhance", "Enhance"), label("enhance", "Voice enhancement"), () -> {
            enhancement.setVisibility(enhancement.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE);
            scheduleHide();
        });
        fullscreen = button("⛶", label("fullscreen", "Full screen"), this::toggleFullscreen);
        resize = button("↘", label("resize", "Resize player"), () -> {
            int oldWidth = width;
            int oldHeight = height;
            width = Math.min(dp(620), board.getWidth());
            height = Math.min(dp(370), board.getHeight());
            layout();
            movedWindow.accept(new JSObject().put("dw", (width - oldWidth) / cssScale)
                .put("dh", (height - oldHeight) / cssScale));
        });
        resize.setOnTouchListener(windowDrag(true));
        for (Button control : new Button[]{previous, play, next, speed, enhance, fullscreen, resize}) {
            buttons.addView(control);
        }

        error = text();
        error.setPadding(dp(12), dp(4), dp(12), dp(4));
        error.setVisibility(View.GONE);
        controls.addView(error);
        boost = text();
        boost.setText("2×");
        boost.setGravity(Gravity.CENTER);
        boost.setPadding(dp(12), dp(6), dp(12), dp(6));
        boost.setBackgroundColor(0xdd222328);
        boost.setVisibility(View.GONE);
        FrameLayout.LayoutParams boostPosition = new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        boostPosition.topMargin = dp(48);
        root.addView(boost, boostPosition);

        dialog.setContentView(root);
        dialog.setOnDismissListener(ignored -> close.run());
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
            window.addFlags(WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL);
            window.setGravity(Gravity.TOP | Gravity.LEFT);
        }
    }

    void show() {
        dialog.show();
        board.addOnLayoutChangeListener(boardLayout);
        readItem();
        update();
    }

    void close() {
        board.removeOnLayoutChangeListener(boardLayout);
        root.removeCallbacks(hide);
        root.removeCallbacks(tick);
        video.setPlayer(null);
        dialog.setOnDismissListener(null);
        dialog.dismiss();
    }

    void readItem() {
        MediaItem item = player.getCurrentMediaItem();
        title.setText(item == null || item.mediaMetadata.title == null
            ? label("title", "Multimedia") : item.mediaMetadata.title);
        updateMode(item != null && Integer.valueOf(MediaMetadata.MEDIA_TYPE_VIDEO).equals(item.mediaMetadata.mediaType));
    }

    void readTracks(Tracks tracks) {
        hasAudio = tracks.isEmpty() || tracks.isTypeSelected(C.TRACK_TYPE_AUDIO);
        if (!tracks.isEmpty()) updateMode(tracks.isTypeSelected(C.TRACK_TYPE_VIDEO));
        updateEnhancement();
    }

    private void updateMode(boolean showVideo) {
        visual = showVideo;
        if (!visual) {
            endBoost();
            if (expanded) toggleFullscreen();
        }
        video.setVisibility(visual ? View.VISIBLE : View.GONE);
        fullscreen.setVisibility(visual ? View.VISIBLE : View.GONE);
        FrameLayout.LayoutParams bounds = (FrameLayout.LayoutParams) controls.getLayoutParams();
        bounds.topMargin = visual ? 0 : dp(48);
        controls.setLayoutParams(bounds);
        setControlsVisible(true);
        layout();
    }

    void update() {
        previous.setEnabled(player.hasPreviousMediaItem());
        next.setEnabled(player.hasNextMediaItem());
        boolean playing = player.getPlayWhenReady() && player.getPlaybackState() != Player.STATE_ENDED
            && player.getPlayerError() == null;
        play.setText(playing ? "Ⅱ" : "▶");
        play.setContentDescription(playing ? label("pause", "Pause") : label("play", "Play"));
        speed.setText(speedLabel(player.getPlaybackParameters().speed));
        video.setKeepScreenOn(visual && player.isPlaying());
        root.removeCallbacks(tick);
        tick.run();
        updateEnhancement();
    }

    void updateEnhancement() {
        int level = processor.level();
        strength.setProgress(level);
        strength.setEnabled(hasAudio);
        enhance.setEnabled(hasAudio);
        if (!hasAudio) enhancement.setVisibility(View.GONE);
        VoiceEnhancementProcessor.Status state = processor.status();
        enhance.setText(label("enhance", "Enhance") + (state == VoiceEnhancementProcessor.Status.ERROR
            ? " !" : level > 0 ? " · " + levels[level] : ""));
        if (android.os.Build.VERSION.SDK_INT >= 30) strength.setStateDescription(levels[level]);
        String message;
        switch (state) {
            case LOADING: message = label("loading", "Loading voice enhancement…"); break;
            case ERROR: message = label("unavailable", "Voice enhancement is unavailable. Original audio is playing."); break;
            default: message = "";
        }
        status.setText(message);
        status.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
    }

    void showError(String message) {
        error.setText(message);
        error.setVisibility(message.isEmpty() ? View.GONE : View.VISIBLE);
        if (!message.isEmpty()) setControlsVisible(true);
        else scheduleHide();
    }

    private void updateProgress() {
        long duration = player.getDuration();
        boolean seekable = duration > 0 && player.isCurrentMediaItemSeekable();
        progress.setEnabled(seekable);
        if (seekDragging) return;
        long position = player.getCurrentPosition();
        progress.setProgress(duration > 0 ? (int) Math.min(SEEK_STEPS, position * SEEK_STEPS / duration) : 0);
        showTime(position);
    }

    private void showTime(long position) {
        time.setText(clock(position) + " / " + clock(player.getDuration()));
    }

    private static String clock(long millis) {
        if (millis == C.TIME_UNSET) return "–:––";
        long seconds = Math.max(0, millis / 1000);
        if (seconds >= 3600) {
            return String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60);
        }
        return String.format(Locale.ROOT, "%d:%02d", seconds / 60, seconds % 60);
    }

    private void togglePlayback() {
        int state = player.getPlaybackState();
        if (player.getPlayWhenReady() && (state == Player.STATE_READY || state == Player.STATE_BUFFERING)) {
            player.pause();
        } else {
            play();
        }
    }

    void play() {
        if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
        if (player.getPlaybackState() == Player.STATE_ENDED) player.seekToDefaultPosition();
        player.play();
    }

    void moveTrack(boolean forward) {
        if (forward && player.hasNextMediaItem()) player.seekToNextMediaItem();
        else if (!forward && player.hasPreviousMediaItem()) player.seekToPreviousMediaItem();
        else return;
        if (player.getPlaybackState() == Player.STATE_IDLE) player.prepare();
    }

    private void chooseSpeed() {
        PopupMenu menu = new PopupMenu(activity, speed);
        for (int i = 0; i < SPEEDS.length; i++) {
            menu.getMenu().add(0, i, i, speedLabel(SPEEDS[i]));
        }
        root.removeCallbacks(hide);
        menu.setOnDismissListener(ignored -> scheduleHide());
        menu.setOnMenuItemClickListener(item -> {
            player.setPlaybackSpeed(SPEEDS[item.getItemId()]);
            return true;
        });
        menu.show();
    }

    private static String speedLabel(float rate) {
        return (rate == (int) rate ? Integer.toString((int) rate) : Float.toString(rate)) + "×";
    }

    private void bindVideoGestures() {
        GestureDetector gestures = new GestureDetector(activity, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent event) { return true; }
            @Override public boolean onSingleTapConfirmed(MotionEvent event) {
                video.performClick();
                setControlsVisible(!controlsVisible);
                return true;
            }
            @Override public boolean onDoubleTap(MotionEvent event) {
                if (player.getPlayerError() == null) togglePlayback();
                return true;
            }
            @Override public void onLongPress(MotionEvent event) {
                float x = event.getX() / Math.max(1, video.getWidth());
                if (beforeBoost == null && player.isPlaying() && (x <= .25f || x >= .75f)) {
                    beforeBoost = player.getPlaybackParameters();
                    player.setPlaybackSpeed(2);
                    boost.setVisibility(View.VISIBLE);
                }
            }
        });
        video.setOnTouchListener((view, event) -> {
            gestures.onTouchEvent(event);
            int action = event.getActionMasked();
            if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) endBoost();
            return true;
        });
    }

    private void endBoost() {
        if (beforeBoost == null) return;
        player.setPlaybackParameters(beforeBoost);
        beforeBoost = null;
        boost.setVisibility(View.GONE);
    }

    private void setControlsVisible(boolean visible) {
        controlsVisible = visible || !visual;
        int visibility = controlsVisible ? View.VISIBLE : View.GONE;
        header.setVisibility(visibility);
        controls.setVisibility(visibility);
        if (!controlsVisible) enhancement.setVisibility(View.GONE);
        scheduleHide();
    }

    private void scheduleHide() {
        root.removeCallbacks(hide);
        if (dialog.isShowing() && visual && controlsVisible && !seekDragging && !seekingStrength
                && error.getVisibility() != View.VISIBLE) {
            root.postDelayed(hide, enhancement.getVisibility() == View.VISIBLE ? 5500 : 3200);
        }
    }

    private void toggleFullscreen() {
        expanded = !expanded;
        fullscreen.setContentDescription(expanded ? label("exitFullscreen", "Exit full screen") : label("fullscreen", "Full screen"));
        resize.setVisibility(expanded ? View.GONE : View.VISIBLE);
        Window window = dialog.getWindow();
        if (window != null) {
            WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(window, window.getDecorView());
            if (expanded) {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(window.getDecorView());
                barsToRestore = 0;
                for (int type : new int[]{WindowInsetsCompat.Type.statusBars(), WindowInsetsCompat.Type.navigationBars()}) {
                    if (insets == null || insets.isVisible(type)) barsToRestore |= type;
                }
                bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                bars.hide(WindowInsetsCompat.Type.systemBars());
            } else if (barsToRestore != 0) {
                bars.show(barsToRestore);
            }
            WindowCompat.setDecorFitsSystemWindows(window, !expanded);
        }
        layout();
    }

    void place(JSObject box, int webWidth) {
        double viewport = box.optDouble("viewport", 0);
        if (viewport <= 0 || webWidth <= 0) return;
        cssScale = (float) (webWidth / viewport);
        left = (int) Math.round(box.optDouble("x") * cssScale);
        top = (int) Math.round(box.optDouble("y") * cssScale);
        width = (int) Math.round(box.optDouble("width") * cssScale);
        height = (int) Math.round(box.optDouble("height") * cssScale);
        boolean visible = width > 0 && height > 0 && left < board.getWidth() && top < board.getHeight()
            && left + width > 0 && top + height > 0;
        if (!visible && !expanded) {
            dialog.hide();
            player.pause();
            return;
        }
        if (!dialog.isShowing()) dialog.show();
        layout();
    }

    private void layout() {
        Window window = dialog.getWindow();
        if (window == null) return;
        int maxWidth = Math.max(dp(240), board.getWidth());
        int maxHeight = Math.max(dp(180), board.getHeight());
        if (width == 0) {
            width = Math.min(dp(620), maxWidth - dp(16));
            height = Math.min(dp(370), maxHeight - dp(16));
            left = (maxWidth - width) / 2;
            top = dp(8);
        }
        width = Math.min(Math.max(dp(232), width), maxWidth);
        height = Math.min(Math.max(dp(168), height), maxHeight);
        // An audio-only object wraps its controls. The controls are its entire body.

        WindowManager.LayoutParams attributes = window.getAttributes();
        attributes.x = expanded ? 0 : left;
        attributes.y = expanded ? 0 : top;
        attributes.width = expanded ? ViewGroup.LayoutParams.MATCH_PARENT : width;
        attributes.height = expanded ? ViewGroup.LayoutParams.MATCH_PARENT
            : visual ? height : ViewGroup.LayoutParams.WRAP_CONTENT;
        window.setAttributes(attributes);
    }

    private View.OnTouchListener windowDrag(boolean sizing) {
        return new View.OnTouchListener() {
            private float x;
            private float y;
            private int startLeft;
            private int startTop;
            private int startWidth;
            private int startHeight;
            private boolean moved;

            @Override public boolean onTouch(View view, MotionEvent event) {
                if (expanded) return false;
                switch (event.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        x = event.getRawX(); y = event.getRawY();
                        startLeft = left; startTop = top; startWidth = width; startHeight = height;
                        moved = false;
                        root.removeCallbacks(hide);
                        view.getParent().requestDisallowInterceptTouchEvent(true);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = Math.round(event.getRawX() - x);
                        int dy = Math.round(event.getRawY() - y);
                        moved = moved || Math.abs(dx) > dp(4) || Math.abs(dy) > dp(4);
                        if (moved) {
                            if (sizing) {
                                width = Math.max(dp(232), startWidth + dx);
                                height = Math.max(dp(168), startHeight + dy);
                            } else {
                                left = Math.max(0, Math.min(startLeft + dx, board.getWidth() - width));
                                top = Math.max(0, Math.min(startTop + dy, board.getHeight() - root.getHeight()));
                            }
                            layout();
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        if (moved) {
                            movedWindow.accept(new JSObject().put("dx", (left - startLeft) / cssScale)
                                .put("dy", (top - startTop) / cssScale).put("dw", (width - startWidth) / cssScale)
                                .put("dh", (height - startHeight) / cssScale));
                        } else view.performClick();
                        scheduleHide();
                        return true;
                    case MotionEvent.ACTION_CANCEL:
                        scheduleHide();
                        return true;
                    default: return true;
                }
            }
        };
    }

    private String label(String key, String fallback) { return labels.optString(key, fallback); }
    private int dp(int value) { return Math.round(value * activity.getResources().getDisplayMetrics().density); }

    private LinearLayout row() {
        LinearLayout row = new LinearLayout(activity);
        row.setGravity(Gravity.CENTER_VERTICAL);
        return row;
    }

    private LinearLayout column() {
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        return column;
    }

    private TextView text() {
        TextView view = new TextView(activity);
        view.setTextColor(Color.WHITE);
        view.setTextSize(14);
        return view;
    }

    private Button button(String text, String description, Runnable action) {
        Button button = new Button(activity, null, android.R.attr.borderlessButtonStyle);
        button.setText(text);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setAllCaps(false);
        button.setMinWidth(dp(42));
        button.setMinimumWidth(dp(42));
        button.setMinimumHeight(dp(44));
        button.setPadding(dp(8), 0, dp(8), 0);
        button.setContentDescription(description);
        button.setOnClickListener(view -> {
            action.run();
            scheduleHide();
        });
        return button;
    }
}
