package com.fcjy.fcboard;

import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.DigitalInkRecognition;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions;
import com.google.mlkit.vision.digitalink.Ink;
import com.google.mlkit.vision.digitalink.RecognitionCandidate;
import com.google.mlkit.vision.digitalink.RecognitionResult;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** A column rule separates operands from a written answer. ML Kit reads each
 * operand row independently; geometry never guesses an arithmetic operator. */
final class NativeMathLayout {
    private static final class Box {
        int offset, count;
        float left = Float.POSITIVE_INFINITY, top = left, right = -left, bottom = -left;
        float height() { return bottom - top; }
        float width() { return right - left; }
    }
    private static List<List<Box>> rows(List<Box> input, float typical) {
        List<Box> sorted = new ArrayList<>(input); sorted.sort(Comparator.comparingDouble(box -> box.top));
        List<List<Box>> rows = new ArrayList<>(); float bottom = -Float.MAX_VALUE;
        for (Box box : sorted) {
            if (rows.isEmpty() || box.top > bottom + typical * .2f) { rows.add(new ArrayList<>()); bottom = box.bottom; }
            else bottom = Math.max(bottom, box.bottom);
            rows.get(rows.size() - 1).add(box);
        }
        return rows;
    }
    static String column(android.content.Context context, float[] points, int[] lengths, LocalInferenceService.Job job) throws Exception {
        List<Box> boxes = new ArrayList<>(); int offset = 0;
        for (int length : lengths) {
            Box box = new Box(); box.offset = offset; box.count = length;
            for (int i = 0; i < length; i++) {
                float x = points[offset++], y = points[offset++];
                box.left = Math.min(box.left, x); box.right = Math.max(box.right, x); box.top = Math.min(box.top, y); box.bottom = Math.max(box.bottom, y);
            }
            if (length > 0) boxes.add(box);
        }
        List<Box> letters = new ArrayList<>();
        for (Box box : boxes) if (box.height() > 4) letters.add(box);
        if (letters.size() < 2) return null;
        letters.sort(Comparator.comparingDouble(Box::height)); float typical = letters.get(letters.size() / 2).height();
        Box rule = null; List<List<Box>> operandRows = null;
        for (Box bar : boxes) {
            if (bar.height() > Math.max(3, typical * .15f) || bar.width() < typical * 1.5f) continue;
            List<Box> above = new ArrayList<>();
            for (Box box : letters) if (box.bottom < bar.top && box.left <= bar.right && box.right >= bar.left) above.add(box);
            List<List<Box>> groups = rows(above, typical);
            if (groups.size() < 2 || groups.size() > 6) continue;
            float left = Float.POSITIVE_INFINITY, right = -left;
            for (Box box : above) { left = Math.min(left, box.left); right = Math.max(right, box.right); }
            if (bar.left > left + typical * .3f || bar.right < right - typical * .3f) continue;
            if (rule == null || bar.width() > rule.width()) { rule = bar; operandRows = groups; }
        }
        if (rule == null) return null;
        // Assign detached horizontal +/- strokes to their actual operand row.
        for (Box box : boxes) {
            if (box == rule || box.bottom >= rule.top || letters.contains(box)) continue;
            for (List<Box> row : operandRows) {
                float top = Float.POSITIVE_INFINITY, bottom = -top;
                for (Box letter : row) { top = Math.min(top, letter.top); bottom = Math.max(bottom, letter.bottom); }
                if (box.top >= top - typical * .2f && box.bottom <= bottom + typical * .2f) { row.add(box); break; }
            }
        }
        DigitalInkModels.install(context);
        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US")).build();
        if (!Tasks.await(RemoteModelManager.getInstance().isModelDownloaded(model), 10, TimeUnit.SECONDS)) throw new IllegalStateException("English handwriting model required for column arithmetic");
        StringBuilder expression = new StringBuilder();
        for (int rowIndex = 0; rowIndex < operandRows.size(); rowIndex++) {
            job.check(); List<Box> row = operandRows.get(rowIndex); row.sort(Comparator.comparingInt(box -> box.offset));
            Ink.Builder ink = Ink.builder();
            for (Box box : row) {
                Ink.Stroke.Builder stroke = Ink.Stroke.builder();
                for (int i = 0; i < box.count; i++) stroke.addPoint(Ink.Point.create(points[box.offset + i * 2], points[box.offset + i * 2 + 1]));
                ink.addStroke(stroke.build());
            }
            DigitalInkRecognizer recognizer = DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build());
            Task<RecognitionResult> task;
            try { task = recognizer.recognize(ink.build()); }
            catch (RuntimeException error) { recognizer.close(); throw error; }
            // Even if await times out, the actual SDK Task owns its client until completion.
            task.addOnCompleteListener(Runnable::run, ignored -> recognizer.close());
            RecognitionResult result = Tasks.await(task, 25, TimeUnit.SECONDS); job.check();
            String chosen = null;
            for (RecognitionCandidate candidate : result.getCandidates()) {
                String value = candidate.getText().trim();
                if (value.matches(rowIndex == 0 ? "[+-]?\\d+(?:\\.\\d+)?" : "[+−－×xX÷➗*/-]\\s*\\d+(?:\\.\\d+)?")) { chosen = value; break; }
            }
            // Nested fractions can also have multiple rows above a bar. Only
            // confirmed numeric/operator rows establish column arithmetic.
            if (chosen == null) {
                if (rowIndex < 2) return null;
                throw new IllegalStateException("Column operand or operator is unreadable");
            }
            if (expression.length() > 0) expression.append('\n'); expression.append(chosen);
        }
        return expression.append("\n----").toString();
    }
}
