package com.fcjy.fcboard;

import android.content.Context;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.io.File;
import java.util.concurrent.CancellationException;
import java.util.function.BooleanSupplier;

/** Pinned sherpa-onnx 1.13.8 Android API; bundled MeloTTS Chinese/English weights. */
final class OfflineTtsEngine implements AutoCloseable {
    private final OfflineTts tts;

    // The JNI looks up invoke(float[]) -> Integer, not the erased Function1 method.
    // A Java lambda exposes only invoke(Object) and aborts ART inside this SDK.
    static final class SynthesisCallback implements kotlin.jvm.functions.Function1<float[], Integer> {
        private final BooleanSupplier cancelled;
        SynthesisCallback(BooleanSupplier cancelled) { this.cancelled = cancelled; }
        @Override public Integer invoke(float[] samples) { return cancelled.getAsBoolean() ? 0 : 1; }
    }

    OfflineTtsEngine(Context context) {
        String assets = "tts/melo/";
        OfflineTtsConfig config = new OfflineTtsConfig();
        OfflineTtsVitsModelConfig vits = config.getModel().getVits();
        vits.setModel(assets + "model.int8.onnx");
        vits.setLexicon(assets + "lexicon.txt");
        vits.setTokens(assets + "tokens.txt");
        config.getModel().setNumThreads(2);
        config.setRuleFsts(assets + "date.fst," + assets + "number.fst," + assets + "phone.fst");
        config.setMaxNumSentences(1);
        tts = new OfflineTts(context.getAssets(), config);
    }

    void synthesize(String text, File output, BooleanSupplier cancelled) {
        if (text == null || text.trim().isEmpty() || text.length() > 1200) {
            throw new IllegalArgumentException("Speech text must contain 1 to 1200 characters");
        }
        if (cancelled.getAsBoolean()) { throw new CancellationException(); }
        GeneratedAudio audio = tts.generateWithCallback(text, 0, 1.0f,
            new SynthesisCallback(cancelled));
        if (cancelled.getAsBoolean()) { throw new CancellationException(); }
        if (audio.getSampleRate() != 44100 || audio.getSamples().length == 0 || !audio.save(output.getAbsolutePath())) {
            throw new IllegalStateException("Offline speech synthesis returned no valid audio");
        }
    }

    @Override public void close() { tts.release(); }
}
