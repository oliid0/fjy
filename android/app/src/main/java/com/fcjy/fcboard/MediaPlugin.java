package com.fcjy.fcboard;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.Tracks;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.audio.AudioOutputProvider;
import androidx.media3.exoplayer.audio.AudioSink;
import androidx.media3.exoplayer.audio.AudioTrackAudioOutputProvider;
import androidx.media3.exoplayer.audio.DefaultAudioSink;
import androidx.media3.exoplayer.audio.ForwardingAudioOutputProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

/** Local multimedia playback. Audio and video share the Media3 PCM chain. */
@androidx.annotation.OptIn(markerClass = UnstableApi.class)
@CapacitorPlugin(name = "FcboardMedia")
public class MediaPlugin extends Plugin {
    private ExoPlayer player;
    private MediaWindow window;
    private VoiceEnhancementProcessor enhancement;
    private boolean choosing;
    private String owner = "";
    private String failure = "";
    @PluginMethod public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (choosing) { call.reject("Media picker is already open"); return; }
            try {
                choosing = true;
                String kind = call.getString("kind", "");
                String[] types = "image".equals(kind) ? new String[]{"image/*"}
                    : "playback".equals(kind) ? new String[]{"audio/*", "video/*"}
                    : new String[]{"image/*", "audio/*", "video/*"};
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_MIME_TYPES, types).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
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
            JSArray playlist = new JSArray();
            JSArray images = new JSArray();
            JSObject selection = new JSObject().put("images", images);
            for (Uri uri : uris) {
                if (!"content".equals(uri.getScheme())) throw new IllegalArgumentException("Select media from the file picker");

                String name = uri.getLastPathSegment();
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                String mime = getContext().getContentResolver().getType(uri);
                if (name == null || name.trim().isEmpty()) name = "Media";
                if (mime == null || mime.equals("application/octet-stream")) {
                    String extension = android.webkit.MimeTypeMap.getFileExtensionFromUrl(Uri.encode(name));
                    mime = android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase(java.util.Locale.ROOT));
                }
                JSObject entry = new JSObject().put("uri", uri.toString()).put("name", name).put("mime", mime);
                if (mime != null && mime.startsWith("image/")) {
                    images.put(entry);
                } else {
                    try { getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION); }
                    catch (SecurityException ignored) { /* Some providers grant only temporary access. */ }
                    if (playlist.length() == 0) selection.put("title", name).put("video", mime != null && mime.startsWith("video/"));
                    playlist.put(entry);
                }
            }
            if (playlist.length() > 0) {
                String key = java.util.UUID.randomUUID().toString();
                getContext().getSharedPreferences("media-playlists", Context.MODE_PRIVATE)
                    .edit().putString(key, playlist.toString()).apply();
                selection.put("key", key);
            }
            call.resolve(selection);
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }
    @PluginMethod public void activate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String key = call.getString("key", "");
                String target = call.getString("owner", "");
                if (target.isEmpty()) throw new IllegalArgumentException("Missing media object");
                String saved = getContext().getSharedPreferences("media-playlists", Context.MODE_PRIVATE).getString(key, null);
                if (saved == null) throw new IllegalArgumentException("Media files are unavailable on this device");
                org.json.JSONArray entries = new org.json.JSONArray(saved);
                List<MediaItem> items = new ArrayList<>();
                for (int i = 0; i < entries.length(); i++) {
                    org.json.JSONObject entry = entries.getJSONObject(i);
                    MediaMetadata.Builder metadata = new MediaMetadata.Builder().setTitle(entry.getString("name"));
                    if (entry.optString("mime").startsWith("video/")) metadata.setMediaType(MediaMetadata.MEDIA_TYPE_VIDEO);
                    items.add(new MediaItem.Builder().setUri(entry.getString("uri")).setMediaMetadata(metadata.build()).build());
                }
                show(items, target, call.getObject("labels", new JSObject()), call.getObject("bounds", new JSObject()));
                call.resolve(state());
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    @PluginMethod public void place(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (window != null && owner.equals(call.getString("owner"))) {
                window.place(call.getObject("bounds", new JSObject()), getBridge().getWebView().getWidth());
            }
            call.resolve();
        });
    }
    private void show(List<MediaItem> items, String target, JSObject labels, JSObject bounds) {
        closePlayer();
        owner = target;
        failure = "";
        VoiceEnhancementProcessor processor = new VoiceEnhancementProcessor(getContext().getAssets(), () -> {
            if (window != null) window.updateEnhancement();
        });
        enhancement = processor;
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(getContext()) {
            @Override protected AudioSink buildAudioSink(Context context, boolean floatOutput, boolean outputSpeed) {
                AudioOutputProvider output = new ForwardingAudioOutputProvider(
                    new AudioTrackAudioOutputProvider.Builder(context).build()
                ) {
                    @Override public FormatSupport getFormatSupport(FormatConfig config) {
                        return MimeTypes.AUDIO_RAW.equals(config.format.sampleMimeType)
                            ? super.getFormatSupport(config) : FormatSupport.UNSUPPORTED;
                    }
                };
                return new DefaultAudioSink.Builder(context)
                    .setAudioOutputProvider(output)
                    .setEnableAudioOutputPlaybackParameters(outputSpeed)
                    .setAudioProcessors(new AudioProcessor[]{processor})
                    .build();
            }
        };
        ExoPlayer shown = new ExoPlayer.Builder(getContext(), renderers).build();
        player = shown;
        shown.setAudioAttributes(new androidx.media3.common.AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        shown.setMediaItems(items);
        MediaWindow controls = new MediaWindow(getActivity(), shown, processor, labels, () -> {
            if (player == shown) {
                notifyListeners("mediaWindow", new JSObject().put("owner", target).put("action", "close"));
                closePlayer();
            }
        }, movement -> notifyListeners("mediaWindow", movement.put("owner", target).put("action", "move")));
        window = controls;
        shown.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException error) {
                if (player != shown) return;
                failure = error.getMessage() == null ? error.getErrorCodeName() : error.getMessage();
                controls.showError(failure);
            }
            @Override public void onMediaItemTransition(MediaItem item, int reason) {
                if (player != shown) return;
                failure = "";
                controls.showError("");
                controls.readItem();
            }
            @Override public void onVideoSizeChanged(androidx.media3.common.VideoSize size) {
                if (player == shown) controls.fitVideo(size);
            }
            @Override public void onTracksChanged(Tracks tracks) {
                if (player == shown) controls.readTracks(tracks);
            }
            @Override public void onEvents(Player current, Player.Events events) {
                if (player != shown) return;
                if (!failure.isEmpty() && current.getPlayerError() == null) {
                    failure = "";
                    controls.showError("");
                }
                int playback = current.getPlaybackState();
                processor.setPlaybackActive(current.getPlayWhenReady()
                    && current.getPlaybackSuppressionReason() == Player.PLAYBACK_SUPPRESSION_REASON_NONE
                    && (playback == Player.STATE_BUFFERING || playback == Player.STATE_READY)
                    && current.getCurrentTracks().isTypeSelected(C.TRACK_TYPE_AUDIO));
                controls.update();
            }
        });
        controls.place(bounds, getBridge().getWebView().getWidth());
        controls.show();
        shown.prepare();
        shown.play();
    }
    private JSObject state() {
        JSObject result = new JSObject().put("open", player != null).put("choosing", choosing);
        if (player == null) return result;
        JSArray items = new JSArray();
        for (int i = 0; i < player.getMediaItemCount(); i++) { CharSequence title = player.getMediaItemAt(i).mediaMetadata.title; items.put(title == null ? "" : title.toString()); }
        return result.put("owner", owner).put("playing", player.isPlaying()).put("position", player.getCurrentPosition() / 1000.0)
            .put("duration", player.getDuration() == C.TIME_UNSET ? -1 : player.getDuration() / 1000.0)
            .put("index", player.getCurrentMediaItemIndex()).put("items", items).put("error", failure)
            .put("speed", player.getPlaybackParameters().speed)
            .put("enhancement", enhancement.level())
            .put("enhancementStatus", enhancement.status().name().toLowerCase(java.util.Locale.ROOT));
    }
    @PluginMethod public void action(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                String action = call.getString("action", "read");
                String requestedOwner = call.getString("owner");
                if (requestedOwner != null && !owner.equals(requestedOwner)) {
                    if (action.equals("close") || action.equals("read")) { call.resolve(new JSObject().put("open", false)); return; }
                    throw new IllegalStateException("This media object is not playing");
                }
                if (action.equals("close")) { closePlayer(); call.resolve(state()); return; }
                if (action.equals("read")) { call.resolve(state()); return; }
                if (player == null) throw new IllegalStateException("Open a media file first");
                switch (action) {
                    case "play": window.play(); break;
                    case "pause": player.pause(); break;
                    case "next": window.moveTrack(true); break;
                    case "previous": window.moveTrack(false); break;
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
                    case "enhance": enhancement.setLevel(call.getInt("level", -1)); break;
                    default: throw new IllegalArgumentException("Unknown media action");
                }
                call.resolve(state());
            } catch (Exception error) { call.reject(error.getMessage(), error); }
        });
    }
    private void closePlayer() {
        if (!owner.isEmpty()) notifyListeners("mediaWindow", new JSObject().put("owner", owner).put("action", "release"));
        owner = "";
        MediaWindow previousWindow = window;
        ExoPlayer previousPlayer = player;
        window = null;
        player = null;
        if (enhancement != null) enhancement.close();
        enhancement = null;
        if (previousWindow != null) previousWindow.close();
        if (previousPlayer != null) previousPlayer.release();
    }
    @Override protected void handleOnPause() { getActivity().runOnUiThread(() -> { if (player != null) player.pause(); }); }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(this::closePlayer); }
}
