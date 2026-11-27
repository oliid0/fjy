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
    private final java.util.concurrent.ExecutorService filesWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
    private final java.util.Map<String,MediaImport> imports=new java.util.HashMap<>();
    private static final class MediaImport {
        final String key;final java.io.File folder;final JSArray files;final long[] sizes;
        int index;long offset;boolean installed;
        MediaImport(String key,java.io.File folder,JSArray files,long[] sizes){this.key=key;this.folder=folder;this.files=files;this.sizes=sizes;}
        void clear(){if(!installed){java.io.File[] children=folder.listFiles();if(children!=null)for(java.io.File file:children)file.delete();folder.delete();}}
    }
    @PluginMethod public void files(PluginCall call){filesWorker.execute(()->{
        try{
            String saved=getContext().getSharedPreferences("media-playlists",Context.MODE_PRIVATE).getString(call.getString("key",""),null);
            if(saved==null)throw new java.io.IOException("Media content is missing");
            call.resolve(new JSObject().put("files",new JSArray(saved)));
        }catch(Exception error){call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void storeBegin(PluginCall call){filesWorker.execute(()->{
        java.io.File folder=null;
        try{
            String key=call.getString("key","");JSArray files=call.getArray("files");
            if(key.isEmpty() || key.length()>200 || files==null || files.length()<1 || files.length()>50)throw new java.io.IOException("Invalid media import");
            long[] sizes=new long[files.length()];long total=0;
            for(int i=0;i<files.length();i++){
                org.json.JSONObject file=files.getJSONObject(i);long size=file.getLong("size");String mime=file.getString("mime");
                if(size<1 || size!=file.getDouble("size") || !(mime.startsWith("audio/") || mime.startsWith("video/")) || file.getString("name").isEmpty())throw new java.io.IOException("Invalid media file");
                total+=size;if(total>64L*1024*1024)throw new java.io.IOException("Media import exceeds 64 MB");sizes[i]=size;
            }
            String id=java.util.UUID.randomUUID().toString();folder=new java.io.File(getContext().getFilesDir(),"media-"+id);if(!folder.mkdir())throw new java.io.IOException("Cannot prepare media storage");
            imports.put(id,new MediaImport(key,folder,files,sizes));call.resolve(new JSObject().put("id",id));
        }catch(Exception error){if(folder!=null)folder.delete();call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void storeAppend(PluginCall call){filesWorker.execute(()->{
        try{
            MediaImport item=imports.get(call.getString("id"));String data=call.getString("data","");
            if(item==null || item.installed || item.index>=item.sizes.length || call.getInt("index",-1)!=item.index || call.getData().optLong("offset",-1L)!=item.offset || data.length()>350000)throw new java.io.IOException("Invalid media chunk");
            byte[] bytes=android.util.Base64.decode(data,android.util.Base64.DEFAULT);
            if(bytes.length<1 || item.offset+bytes.length>item.sizes[item.index])throw new java.io.IOException("Media size exceeded");
            try(java.io.OutputStream out=new java.io.FileOutputStream(new java.io.File(item.folder,item.index+".media"),true)){out.write(bytes);}
            item.offset+=bytes.length;if(item.offset==item.sizes[item.index]){item.index++;item.offset=0;}call.resolve();
        }catch(Exception error){call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void storeFinish(PluginCall call){filesWorker.execute(()->{
        try{
            MediaImport item=imports.get(call.getString("id"));if(item==null || item.index!=item.sizes.length)throw new java.io.IOException("Media import incomplete");JSArray entries=new JSArray();
            for(int i=0;i<item.files.length();i++){org.json.JSONObject source=item.files.getJSONObject(i);entries.put(new JSObject().put("uri",Uri.fromFile(new java.io.File(item.folder,i+".media")).toString()).put("name",source.getString("name")).put("mime",source.getString("mime")));}
            if(!getContext().getSharedPreferences("media-playlists",Context.MODE_PRIVATE).edit().putString(item.key,entries.toString()).commit())throw new java.io.IOException("Cannot save media playlist");
            item.installed=true;call.resolve();
        }catch(Exception error){call.reject(error.getMessage(),error);}
    });}
    @PluginMethod public void storeClose(PluginCall call){filesWorker.execute(()->{MediaImport item=imports.remove(call.getString("id"));if(item!=null)item.clear();call.resolve();});}
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
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
                startActivityForResult(call, intent, "chosen");
            } catch (Exception error) { choosing = false; call.reject(error.getMessage(), error); }
        });
    }
    @ActivityCallback private void chosen(PluginCall call, ActivityResult result) {
        choosing = false;
        if (call == null) return;
        filesWorker.execute(() -> readSelection(call, result));
    }
    private void readSelection(PluginCall call, ActivityResult result) {
        java.io.File copies = null;
        List<java.io.File> created = new ArrayList<>();
        try {
            Intent data = result.getData();
            if (result.getResultCode() != Activity.RESULT_OK || data == null) { call.resolve(new JSObject().put("cancelled", true)); return; }
            List<Uri> uris = new ArrayList<>();
            if (data.getClipData() != null) {
                if (data.getClipData().getItemCount() > 50) throw new IllegalArgumentException("Select at most 50 files");
                for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
            } else if (data.getData() != null) uris.add(data.getData());
            if (uris.isEmpty()) throw new IllegalArgumentException("No files selected");
            JSObject fileTypes = call.getObject("fileTypes");
            if (fileTypes == null) throw new IllegalArgumentException("Missing supported file types");
            java.util.Set<String> imageTypes = new java.util.HashSet<>();
            for (java.util.Iterator<String> keys = fileTypes.keys(); keys.hasNext(); ) {
                String mime = fileTypes.optString(keys.next());
                if (mime.startsWith("image/")) imageTypes.add(mime);
            }
            JSArray playlist = new JSArray();
            JSArray images = new JSArray();
            JSArray documents = new JSArray();
            JSObject selection = new JSObject().put("images", images).put("documents",documents);
            for (Uri uri : uris) {
                if (uri == null || !"content".equals(uri.getScheme())) throw new IllegalArgumentException("Select a file from the system picker");

                String name = uri.getLastPathSegment();
                try (Cursor cursor = getContext().getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                    if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
                }
                if (name == null || name.trim().isEmpty()) name = "File";
                int dot = name.lastIndexOf('.');
                String extension = dot < 0 ? "" : name.substring(dot + 1).toLowerCase(java.util.Locale.ROOT);
                String mapped = fileTypes.optString(extension);
                String mime = mapped.isEmpty() ? getContext().getContentResolver().getType(uri) : mapped;
                JSObject entry = new JSObject().put("uri", uri.toString()).put("name", name).put("mime", mime);
                if (imageTypes.contains(mime)) {
                    images.put(entry);
                } else if (mime != null && (mime.startsWith("audio/") || mime.startsWith("video/"))) {
                    if (playlist.length() == 0) selection.put("title", name).put("video", mime.startsWith("video/"));
                    playlist.put(entry);
                } else if ("application/octet-stream".equals(mapped)) {
                    documents.put(entry);
                } else {
                    throw new IllegalArgumentException("Unsupported file type: "+name);
                }
            }
            if (playlist.length() > 0) {
                String key = java.util.UUID.randomUUID().toString();
                for (int i = 0; i < playlist.length(); i++) {
                    org.json.JSONObject entry = playlist.getJSONObject(i);
                    Uri uri = Uri.parse(entry.getString("uri"));
                    try {
                        getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    } catch (SecurityException temporaryGrant) {
                        if (copies == null) {
                            copies = new java.io.File(getContext().getFilesDir(), "media-" + key);
                            if (!copies.mkdir()) throw new java.io.IOException("Cannot prepare media storage");
                        }
                        java.io.File copy = new java.io.File(copies, i + ".media");
                        created.add(copy);
                        try (java.io.InputStream input = getContext().getContentResolver().openInputStream(uri);
                             java.io.OutputStream output = new java.io.FileOutputStream(copy)) {
                            if (input == null) throw new java.io.IOException("Cannot read selected media");
                            byte[] buffer = new byte[65536];
                            int count;
                            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                        }
                        if (copy.length() == 0) throw new java.io.IOException("The selected media file is empty");
                        entry.put("uri", Uri.fromFile(copy).toString());
                    }
                }
                boolean saved = getContext().getSharedPreferences("media-playlists", Context.MODE_PRIVATE)
                    .edit().putString(key, playlist.toString()).commit();
                if (!saved) throw new java.io.IOException("Cannot save media playlist");
                selection.put("key", key);
            }
            call.resolve(selection);
        } catch (Exception error) {
            for (java.io.File copy : created) copy.delete();
            if (copies != null) copies.delete();
            call.reject(error.getMessage(), error);
        }
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
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(this::closePlayer);filesWorker.execute(()->{for(MediaImport item:imports.values())item.clear();imports.clear();});filesWorker.shutdown(); }
}
