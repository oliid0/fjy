package com.fcjy.fcboard;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Unigram Viterbi segmentation for the pinned Marian tokenizer.json contract.
 * Follows Hugging Face tokenizers' unigram model, WhitespaceSplit and Metaspace.
 * No JavaScript runtime, native tokenizer ABI or remote vocabulary is involved. */
final class MarianTokenizer {
    private final String[] pieces;
    private final double[] scores;
    private final Map<String, Integer> ids = new HashMap<>();
    private int maxPiece;
    private double unknownScore = Double.POSITIVE_INFINITY;
    private final int unknown, eos, pad;
    MarianTokenizer(JSONObject tokenizer) throws Exception {
        JSONObject model = tokenizer.getJSONObject("model");
        if (!model.getString("type").equals("Unigram")) throw new IllegalArgumentException("Expected Marian Unigram tokenizer");
        JSONArray vocab = model.getJSONArray("vocab");
        pieces = new String[vocab.length()]; scores = new double[vocab.length()];
        for (int i = 0; i < vocab.length(); i++) {
            JSONArray entry = vocab.getJSONArray(i);
            pieces[i] = entry.getString(0); scores[i] = entry.getDouble(1);
            ids.put(pieces[i], i); maxPiece = Math.max(maxPiece, pieces[i].length());
            unknownScore = Math.min(unknownScore, scores[i]);
        }
        unknownScore -= 10;
        unknown = ids.get("<unk>"); eos = ids.get("</s>"); pad = ids.get("<pad>");
    }
    int eos() { return eos; }
    int pad() { return pad; }
    long[] encode(String input, boolean simplifiedChinese) {
        List<Integer> result = new ArrayList<>();
        if (simplifiedChinese) {
            Integer language = ids.get(">>cmn_Hans<<");
            if (language == null) throw new IllegalStateException("Required OPUS target language token is missing");
            result.add(language);
        }
        // Precompiled normalizer in this pinned export has no charsmap; NFKC is
        // SentencePiece's documented default and preserves Latin/CJK word data.
        String text = Normalizer.normalize(input, Normalizer.Form.NFKC).trim();
        for (String word : text.split("\\s+")) {
            if (word.isEmpty()) continue;
            String value = "▁" + word;
            double[] best = new double[value.length() + 1];
            int[] previous = new int[best.length], token = new int[best.length];
            Arrays.fill(best, Double.NEGATIVE_INFINITY); best[0] = 0;
            for (int start = 0; start < value.length();) {
                int single = Character.charCount(value.codePointAt(start));
                boolean hasSingle = false;
                for (int end = start + single; end <= Math.min(value.length(), start + maxPiece);) {
                    Integer id = ids.get(value.substring(start, end));
                    if (id != null && id != pad && id != eos) {
                        hasSingle |= end == start + single;
                        double score = best[start] + scores[id];
                        if (score > best[end]) { best[end] = score; previous[end] = start; token[end] = id; }
                    }
                    if (end == value.length()) break;
                    end += Character.charCount(value.codePointAt(end));
                }
                if (!hasSingle && best[start] + unknownScore > best[start + single]) {
                    best[start + single] = best[start] + unknownScore;
                    previous[start + single] = start; token[start + single] = unknown;
                }
                start += single;
            }
            List<Integer> reversed = new ArrayList<>();
            for (int end = value.length(); end > 0; end = previous[end]) reversed.add(token[end]);
            Collections.reverse(reversed);
            for (int id : reversed) {
                if (id != unknown || result.isEmpty() || result.get(result.size() - 1) != unknown) result.add(id);
            }
        }
        result.add(eos);
        if (result.size() > 256) throw new IllegalArgumentException("Translation segment exceeds token limit");
        long[] output = new long[result.size()];
        for (int i = 0; i < output.length; i++) output[i] = result.get(i);
        return output;
    }
    String decode(List<Integer> tokens) {
        StringBuilder result = new StringBuilder();
        for (int id : tokens) {
            if (id == eos || id == pad) continue;
            if (id == unknown || id < 0 || id >= pieces.length) throw new IllegalStateException("Translation contains an unknown token");
            if (!pieces[id].startsWith(">>")) result.append(pieces[id]);
        }
        return result.toString().replace('▁', ' ').trim()
            .replaceAll(" +([.,!?;:])", "$1").replace(" n't", "n't").replace(" 's", "'s");
    }
}
