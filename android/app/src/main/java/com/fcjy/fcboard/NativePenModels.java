package com.fcjy.fcboard;

import android.content.Context;
import android.os.Bundle;
import ai.onnxruntime.OnnxJavaType;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

/** ONNX contracts inspected directly from the pinned shipped model protobufs.
 * CoMER decoding follows ink-on 0.1.0 (kimseungdae, Apache-2.0); Marian uses
 * cached autoregressive decoding, EOS and repetition constraints. CPU only.
 * This class is instantiated exclusively by LocalInferenceService. */
final class NativePenModels implements AutoCloseable {
    private final Context context;
    private final OrtEnvironment environment = OrtEnvironment.getEnvironment();
    private OrtSession encoder, decoder;
    private String loaded;
    private MarianTokenizer tokenizer;
    private JSONObject vocab;
    private final Map<String, String> translations = new LinkedHashMap<String, String>(32, .75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, String> entry) { return size() > 32; }
    };
    NativePenModels(Context context) { this.context = context; }
    Bundle infer(LocalInferenceService.Job job) throws Exception {
        if (job.input.getString("kind", "").equals("math")) {
            String column = NativeMathLayout.column(context, job.input.getFloatArray("points"), job.input.getIntArray("lengths"), job);
            if (column == null) { ensure("comer"); job.check(); column = math(job); }
            Bundle result = new Bundle(); result.putString("latex", column); return result;
        }
        String source = job.input.getString("source"), target = job.input.getString("target"), text = job.input.getString("text");
        String key = source + ":" + target + ":" + text;
        String translated = translations.get(key);
        if (translated == null) {
            ensure("Xenova/opus-mt-" + source + "-" + target); job.check();
            StringBuilder output = new StringBuilder();
            // Keep input order/newlines, cap encoder attention and KV cache size.
            int start = 0;
            while (start < text.length()) {
                int end = Math.min(text.length(), start + 80);
                if (end < text.length() && Character.isHighSurrogate(text.charAt(end - 1))) end--;
                for (int i = start; i < end; i++) if ("。！？.!?\n".indexOf(text.charAt(i)) >= 0) { end = i + 1; break; }
                String part = text.substring(start, end);
                if (part.trim().isEmpty()) output.append(part);
                else {
                    if (output.length() > 0 && target.equals("en") && !Character.isWhitespace(output.charAt(output.length() - 1))) output.append(' ');
                    output.append(translate(part, job));
                    if (part.endsWith("\n")) output.append('\n');
                }
                start = end; job.check();
            }
            translated = output.toString().trim();
            if (translated.isEmpty() || translated.length() > 10000) throw new IllegalStateException("Empty or oversized translation");
            translations.put(key, translated);
        }
        Bundle result = new Bundle(); result.putString("language", source); result.putString("translation", translated); result.putString("engine", "onnxruntime"); return result;
    }
    private JSONObject json(String name) throws Exception {
        try (InputStream input = context.getAssets().open("inference/" + name); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32768]; int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return new JSONObject(bytes.toString("UTF-8"));
        }
    }
    private File model(String name) throws Exception {
        File file = new File(context.getNoBackupFilesDir(), "inference-v1/" + name);
        // Assets are checksum verified before packaging; this versioned private
        // copy lets ORT load by path without an entire model byte[] in ART.
        long expected;
        try (android.content.res.AssetFileDescriptor descriptor = context.getAssets().openFd("inference/" + name)) { expected = descriptor.getLength(); }
        if (file.isFile() && file.length() == expected) return file;
        File parent = file.getParentFile();
        if (!parent.isDirectory() && !parent.mkdirs()) throw new IllegalStateException("Cannot prepare local model directory");
        File pending = new File(file.getPath() + ".pending");
        try (InputStream input = context.getAssets().open("inference/" + name); FileOutputStream output = new FileOutputStream(pending)) {
            byte[] buffer = new byte[131072]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        }
        if (pending.length() != expected || !pending.renameTo(file)) throw new IllegalStateException("Incomplete native model copy");
        return file;
    }
    private void ensure(String key) throws Exception {
        if (key.equals(loaded)) return;
        close();
        try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
            options.setIntraOpNumThreads(2); options.setInterOpNumThreads(1);
            options.setMemoryPatternOptimization(false); options.setCPUArenaAllocator(false);
            boolean math = key.equals("comer");
            encoder = environment.createSession(model(key + (math ? "/encoder_int8.onnx" : "/onnx/encoder_model_quantized.onnx")).getPath(), options);
            decoder = environment.createSession(model(key + (math ? "/decoder_int8.onnx" : "/onnx/decoder_model_merged_quantized.onnx")).getPath(), options);
            if (math) vocab = json("comer/vocab.json");
            else tokenizer = new MarianTokenizer(json(key + "/tokenizer.json"));
            loaded = key;
        } catch (Exception | LinkageError error) { close(); throw error; }
    }
    private OrtSession.Result run(OrtSession session, Map<String, OnnxTensor> inputs, LocalInferenceService.Job job) throws Exception {
        job.check();
        try (OrtSession.RunOptions options = new OrtSession.RunOptions()) {
            job.attach(options);
            try { return session.run(inputs, options); }
            finally { job.detach(); }
        }
    }
    private static OnnxTensor tensor(OrtSession.Result result, String name) {
        return (OnnxTensor)result.get(name).orElseThrow(() -> new IllegalStateException("Missing native model output: " + name));
    }
    private OnnxTensor ids(long[] values) throws Exception {
        return OnnxTensor.createTensor(environment, LongBuffer.wrap(values), new long[]{1, values.length});
    }
    private String translate(String text, LocalInferenceService.Job job) throws Exception {
        long[] input = tokenizer.encode(text, loaded.endsWith("-en-zh")), attention = new long[input.length]; Arrays.fill(attention, 1);
        try (OnnxTensor inputIds = ids(input); OnnxTensor mask = ids(attention);
             OnnxTensor empty = OnnxTensor.createTensor(environment, FloatBuffer.allocate(0), new long[]{1, 8, 0, 64});
             OnnxTensor off = OnnxTensor.createTensor(environment, new boolean[]{false});
             OnnxTensor on = OnnxTensor.createTensor(environment, new boolean[]{true})) {
            Map<String, OnnxTensor> feed = new HashMap<>(); feed.put("input_ids", inputIds); feed.put("attention_mask", mask);
            try (OrtSession.Result encoded = run(encoder, feed, job)) {
                OrtSession.Result first = null;
                List<TranslationBeam> beams = new ArrayList<>();
                beams.add(new TranslationBeam(new long[]{tokenizer.pad()}, 0, false, null));
                int beamWidth = loaded.endsWith("-en-zh") ? 4 : 1;
                try {
                    int limit = Math.min(192, Math.max(24, input.length * 4 + 12));
                    for (int step = 0; step < limit; step++) {
                        List<TranslationBeam> candidates = new ArrayList<>();
                        java.util.Set<OrtSession.Result> created = new java.util.HashSet<>();
                        try {
                            for (TranslationBeam beam : beams) {
                                if (beam.finished) { candidates.add(beam); continue; }
                                feed = new HashMap<>(); feed.put("encoder_attention_mask", mask);
                                feed.put("encoder_hidden_states", tensor(encoded, "last_hidden_state"));
                                feed.put("use_cache_branch", step == 0 ? off : on);
                                for (String name : decoder.getInputNames()) if (name.startsWith("past_key_values.")) {
                                    String output = name.replace("past_key_values.", "present.");
                                    feed.put(name, step == 0 ? empty : tensor(name.contains(".encoder.") ? first : beam.past, output));
                                }
                                OrtSession.Result current;
                                try (OnnxTensor token = ids(new long[]{beam.ids[beam.ids.length - 1]})) {
                                    feed.put("input_ids", token); current = run(decoder, feed, job);
                                }
                                created.add(current); if (first == null) first = current;
                                FloatBuffer logits = tensor(current, "logits").getFloatBuffer();
                                double[] scores = new double[logits.limit()]; double max = -Double.MAX_VALUE;
                                for (int id = 0; id < scores.length; id++) {
                                    double score = logits.get(id);
                                    if (id == tokenizer.pad() || repeatedTrigram(beam.ids, id)) score = Double.NEGATIVE_INFINITY;
                                    else if (id != tokenizer.eos() && contains(beam.ids, id)) score = score > 0 ? score / 1.15 : score * 1.15;
                                    scores[id] = score; max = Math.max(max, score);
                                }
                                double sum = 0; for (double score : scores) sum += Math.exp(score - max);
                                double normalizer = max + Math.log(sum);
                                // A bounded top-k avoids sorting the entire 65k vocabulary.
                                int[] top = new int[beamWidth * 2]; Arrays.fill(top, -1);
                                for (int id = 0; id < scores.length; id++) {
                                    if (!Double.isFinite(scores[id])) continue;
                                    for (int at = 0; at < top.length; at++) {
                                        if (top[at] < 0 || scores[id] > scores[top[at]]) {
                                            for (int j = top.length - 1; j > at; j--) top[j] = top[j - 1];
                                            top[at] = id; break;
                                        }
                                    }
                                }
                                for (int id : top) if (id >= 0) {
                                    long[] tokens = Arrays.copyOf(beam.ids, beam.ids.length + 1); tokens[tokens.length - 1] = id;
                                    candidates.add(new TranslationBeam(tokens, beam.score + scores[id] - normalizer, id == tokenizer.eos(), current));
                                }
                                job.check();
                            }
                            candidates.sort(Comparator.comparingDouble(TranslationBeam::rank).reversed());
                            List<TranslationBeam> next = new ArrayList<>(candidates.subList(0, Math.min(beamWidth, candidates.size())));
                            java.util.Set<OrtSession.Result> retained = caches(next); retained.add(first);
                            for (OrtSession.Result old : caches(beams)) if (!retained.contains(old)) old.close();
                            for (OrtSession.Result unused : created) if (!retained.contains(unused)) unused.close();
                            created.clear(); beams = next;
                        } finally {
                            // On failure, close every newly allocated result except
                            // first (closed by the outer scope); old beams still own theirs.
                            for (OrtSession.Result result : created) if (result != first) result.close();
                        }
                        if (beams.stream().allMatch(beam -> beam.finished)) break;
                    }
                    for (TranslationBeam beam : beams) if (beam.finished) {
                        List<Integer> tokens = new ArrayList<>();
                        for (int i = 1; i < beam.ids.length; i++) tokens.add((int)beam.ids[i]);
                        return tokenizer.decode(tokens);
                    }
                    throw new IllegalStateException("Translation did not finish within its token budget");
                } finally {
                    for (OrtSession.Result result : caches(beams)) if (result != first) result.close();
                    if (first != null) first.close();
                }
            }
        }
    }
    private static final class TranslationBeam {
        final long[] ids; final double score; final boolean finished; final OrtSession.Result past;
        TranslationBeam(long[] ids, double score, boolean finished, OrtSession.Result past) { this.ids = ids; this.score = score; this.finished = finished; this.past = past; }
        double rank() { return score / Math.max(1, ids.length - 1); }
    }
    private static java.util.Set<OrtSession.Result> caches(List<TranslationBeam> beams) {
        java.util.Set<OrtSession.Result> result = new java.util.HashSet<>();
        for (TranslationBeam beam : beams) if (beam.past != null) result.add(beam.past);
        return result;
    }
    private static boolean contains(long[] values, int id) { for (long value : values) if (value == id) return true; return false; }
    private static boolean repeatedTrigram(long[] tokens, int next) {
        int n = tokens.length; if (n < 3) return false;
        for (int i = 1; i + 2 < n; i++) if (tokens[i] == tokens[n - 2] && tokens[i + 1] == tokens[n - 1] && tokens[i + 2] == next) return true;
        return false;
    }
    private static final class Beam {
        final long[] ids; final double score; final boolean finished;
        Beam(long[] ids, double score, boolean finished) { this.ids = ids; this.score = score; this.finished = finished; }
        double rank() { return score / ids.length; }
    }
    private String math(LocalInferenceService.Job job) throws Exception {
        MathInkTensor ink = new MathInkTensor(job.input.getFloatArray("points"), job.input.getIntArray("lengths"));
        JSONObject special = vocab.getJSONObject("special_tokens"), words = vocab.getJSONObject("idx2word");
        int size = vocab.getInt("vocab_size"), sos = special.getInt("sos"), eos = special.getInt("eos"), pad = special.getInt("pad");
        try (OnnxTensor pixels = OnnxTensor.createTensor(environment, ink.pixels, new long[]{1, 1, ink.height, ink.width});
             OnnxTensor mask = OnnxTensor.createTensor(environment, ink.mask, new long[]{1, ink.height, ink.width}, OnnxJavaType.BOOL)) {
            Map<String, OnnxTensor> feed = new HashMap<>(); feed.put("pixel_values", pixels); feed.put("pixel_mask", mask);
            try (OrtSession.Result encoded = run(encoder, feed, job)) {
                List<Beam> beams = new ArrayList<>(); beams.add(new Beam(new long[]{sos}, 0, false));
                for (int step = 0; step < 96; step++) {
                    List<Beam> candidates = new ArrayList<>();
                    for (Beam beam : beams) {
                        if (beam.finished) { candidates.add(beam); continue; }
                        feed = new HashMap<>(); feed.put("encoder_features", tensor(encoded, "encoder_features")); feed.put("encoder_mask", tensor(encoded, "encoder_mask"));
                        try (OnnxTensor tokens = ids(beam.ids)) {
                            feed.put("input_ids", tokens);
                            try (OrtSession.Result decoded = run(decoder, feed, job)) {
                                FloatBuffer logits = tensor(decoded, "logits").getFloatBuffer(); int offset = (beam.ids.length - 1) * size;
                                double max = -Double.MAX_VALUE, sum = 0;
                                for (int i = 0; i < size; i++) max = Math.max(max, logits.get(offset + i));
                                for (int i = 0; i < size; i++) sum += Math.exp(logits.get(offset + i) - max);
                                final double norm = max + Math.log(sum);
                                Integer[] order = new Integer[size]; for (int i = 0; i < size; i++) order[i] = i;
                                Arrays.sort(order, (a, b) -> Float.compare(logits.get(offset + b), logits.get(offset + a)));
                                int used = 0;
                                for (int id : order) {
                                    if (id == pad || id == sos) continue;
                                    long[] extended = id == eos ? beam.ids : Arrays.copyOf(beam.ids, beam.ids.length + 1);
                                    if (id != eos) extended[extended.length - 1] = id;
                                    candidates.add(new Beam(extended, beam.score + logits.get(offset + id) - norm, id == eos));
                                    if (++used == 6) break;
                                }
                            }
                        }
                    }
                    candidates.sort(Comparator.comparingDouble(Beam::rank).reversed());
                    beams = new ArrayList<>(candidates.subList(0, Math.min(3, candidates.size())));
                    if (beams.stream().allMatch(beam -> beam.finished)) break;
                    job.check();
                }
                for (Beam beam : beams) {
                    if (!beam.finished) continue;
                    StringBuilder latex = new StringBuilder(); int depth = 0; boolean valid = true;
                    for (int i = 1; i < beam.ids.length; i++) {
                        String word = words.getString(String.valueOf(beam.ids[i]));
                        if (word.equals("{")) depth++; else if (word.equals("}")) depth--;
                        if (depth < 0) valid = false;
                        if (latex.length() > 0) latex.append(' '); latex.append(word);
                    }
                    if (valid && depth == 0 && latex.length() > 0) return latex.toString();
                }
                throw new IllegalStateException("No complete mathematical expression recognized");
            }
        }
    }
    @Override public void close() {
        if (decoder != null) try { decoder.close(); } catch (Exception ignored) { }
        if (encoder != null) try { encoder.close(); } catch (Exception ignored) { }
        encoder = null; decoder = null; tokenizer = null; vocab = null; loaded = null;
    }
}
