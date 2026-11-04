package com.fcjy.fcboard;

import android.app.Activity;
import android.app.Dialog;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.result.ActivityResult;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/** apkxa Multimedia's local player, backed by Media3 rather than another installed package. */
@androidx.annotation.OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "FcboardMedia")
public class MediaPlugin extends Plugin {
    private ExoPlayer player;
    private Dialog dialog;
    private PlayerView video;
    private boolean choosing;
    private String failure = "";
    @PluginMethod public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (choosing) { call.reject("Media picker is already open"); return; }
            try {
                choosing = true;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"video/*", "audio/*"}).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(call, intent, "chosen");
            } catch (Exception error) { choosing = false; call.reject(error.getMessage(), error); }
        });
    }
    @ActivityCallback private void chosen(PluginCall call, ActivityResult result) {
        choosing = false;
        if (call == null) return;
        try {
            Intent data = result.getData();
            if (result.getResultCode() != Activity.RESULT_OK || data == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                if (data.getClipData().getItemCount() > 50) throw new IllegalArgumentException("Select at most 50 media files");
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            if (uris.isEmpty()) throw new IllegalArgumentException("No media selected");
            List<MediaItem> items = new ArrayList<>();
            for (Uri uri : uris) {
                if (!"content".equals(uri.getScheme())) throw new IllegalArgumentException("Select media from the file picker");
                try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (SecurityException ignored) { }
                String name = uri.getLastPathSegment();
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                items.add(new MediaItem.Builder().setUri(uri).setMediaMetadata(new MediaMetadata.Builder().setTitle(name).build()).build());
            }
            show(items, call.getObject("labels", new JSObject()));
            call.resolve(state());
        } catch (Exception error) { release(); call.reject(error.getMessage(), error); }
    }
    private void show(List<MediaItem> items, JSObject labels) {
        if (dialog != null) dialog.dismiss();
        player = new ExoPlayer.Builder(getContext()).build();
        player.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        failure = "";
        dialog = new Dialog(getActivity()); dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout content = new LinearLayout(getActivity()); content.setOrientation(LinearLayout.VERTICAL); content.setBackgroundColor(Color.BLACK);
        LinearLayout bar = new LinearLayout(getActivity());
        TextView status = new TextView(getActivity()); status.setTextColor(Color.WHITE); status.setPadding(16, 12, 16, 12); status.setText(labels.optString("title", "Media"));
        bar.addView(status, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(getActivity()); close.setText(labels.optString("close", "Close")); close.setOnClickListener(view -> { if (dialog != null) dialog.dismiss(); }); bar.addView(close);
        content.addView(bar);
        video = new PlayerView(getActivity()); video.setPlayer(player); video.setKeepScreenOn(true);
        content.addView(video, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        dialog.setContentView(content); dialog.setOnDismissListener(ignored -> release()); dialog.show();
        if (dialog.getWindow() != null) dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) { failure = error.getMessage() == null ? error.getErrorCodeName() : error.getMessage(); status.setText(failure); }
            @Override public void onMediaItemTransition(MediaItem item, int reason) { if (item != null && failure.isEmpty()) status.setText(item.mediaMetadata.title); }
        });
        player.setMediaItems(items); player.prepare(); player.play();
    }
    private JSObject state() {
        JSObject result = new JSObject().put("open", player != null).put("choosing", choosing);
        if (player == null) return result;
        JSArray items = new JSArray();
        for (int i = 0; i < player.getMediaItemCount(); i++) { CharSequence title = player.getMediaItemAt(i).mediaMetadata.title; items.put(title == null ? "" : title.toString()); }
        return result.put("playing", player.isPlaying()).put("position", player.getCurrentPosition() / 1000.0)
            .put("duration", player.getDuration() == C.TIME_UNSET ? -1 : player.getDuration() / 1000.0)
            .put("index", player.getCurrentMediaItemIndex()).put("items", items).put("error", failure);
    }
    @PluginMethod public void action(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String action = call.getString("action", "read");
                if (action.equals("close")) { if (dialog != null) dialog.dismiss(); call.resolve(state()); return; }
                if (action.equals("read")) { call.resolve(state()); return; }
                if (player == null) throw new IllegalStateException("Open a media file first");
                switch (action) {
                    case "play": player.play(); break;
                    case "pause": player.pause(); break;
                    case "next": player.seekToNextMediaItem(); break;
                    case "previous": player.seekToPreviousMediaItem(); break;
                    case "seek": {
                        double seconds = call.getDouble("seconds", -1.0);
                        if (!Double.isFinite(seconds) || seconds < 0 || player.getDuration() == C.TIME_UNSET || seconds * 1000 > player.getDuration()) throw new IllegalArgumentException("Invalid playback position");
                        player.seekTo((long) (seconds * 1000)); break;
                    }
                    case "speed": {
                        double speed = call.getDouble("speed", -1.0);
                        if (!Double.isFinite(speed) || speed < 0.25 || speed > 3) throw new IllegalArgumentException("Invalid playback speed");
                        player.setPlaybackParameters(new PlaybackParameters((float) speed)); break;
                    }
                    default: throw new IllegalArgumentException("Unknown media action");
                }
                call.resolve(state());
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    private void release() { if (video != null) video.setPlayer(null); video = null; if (player != null) player.release(); player = null; dialog = null; }
    @Override protected void handleOnPause() { getActivity().runOnUiThread(() -> { if (player != null) player.pause(); }); }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(() -> { if (dialog != null) dialog.dismiss(); release(); }); }
}
