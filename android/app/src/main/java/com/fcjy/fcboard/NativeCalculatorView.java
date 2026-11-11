package com.fcjy.fcboard;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.Button;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayList;
import java.util.List;
import net.objecthunter.exp4j.ExpressionBuilder;
import net.objecthunter.exp4j.function.Function;

/** The calculator object is Android Views; there is no calculator WebView.
 * Layout weights follow its actual width and height independently. */
final class NativeCalculatorView extends LinearLayout {
    interface Events { void action(String type, float dx, float dy); }
    private final Events events;
    private final LinearLayout header, science;
    private final GridLayout keypad;
    private final TextView history, input, result;
    private final List<Button> controls = new ArrayList<>();
    private String expression = "", lastResult = "0", previous = "";
    private boolean scientific, degrees, inverse, dark, finished, error;
    private boolean interactionEnabled = true;
    private long revision;
    private float downX, downY;
    NativeCalculatorView(Context context, Events events) {
        super(context); this.events = events; setOrientation(VERTICAL); setClipChildren(true);
        header = new LinearLayout(context); header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(context); title.setText("Calculator"); title.setSingleLine(true);
        header.addView(title, new LinearLayout.LayoutParams(0, -1, 1));
        title.setOnTouchListener((view, event) -> gesture(event, "move"));
        header.addView(key("☀", () -> theme(!dark)));
        header.addView(key("Basic", () -> mode(false)));
        header.addView(key("Sci", () -> mode(true)));
        header.addView(key("×", () -> events.action("close", 0, 0)));
        addView(header, new LayoutParams(-1, 0, .08f));
        LinearLayout display = new LinearLayout(context); display.setOrientation(VERTICAL); display.setGravity(Gravity.BOTTOM);
        history = line(context); input = line(context); result = line(context); result.setText("0");
        display.addView(history, new LayoutParams(-1, 0, 1)); display.addView(input, new LayoutParams(-1, 0, 1)); display.addView(result, new LayoutParams(-1, 0, 2));
        addView(display, new LayoutParams(-1, 0, .22f));
        keypad = new GridLayout(context); keypad.setColumnCount(4); keypad.setRowCount(5);
        String[] keys = {"AC", "⌫", "%", "÷", "7", "8", "9", "×", "4", "5", "6", "−", "1", "2", "3", "+", "+/−", "0", ".", "="};
        for (int i = 0; i < keys.length; i++) {
            final String label = keys[i];
            Button button = key(label, () -> press(label));
            GridLayout.LayoutParams layout = new GridLayout.LayoutParams(GridLayout.spec(i / 4, 1f), GridLayout.spec(i % 4, 1f));
            layout.width = 0; layout.height = 0; layout.setMargins(1, 1, 1, 1); keypad.addView(button, layout);
        }
        addView(keypad, new LayoutParams(-1, 0, .70f));
        science = new LinearLayout(context); science.setOrientation(VERTICAL);
        String[][] more = {{"DEG/RAD", "Inv", "(", ")"}, {"sin", "cos", "tan", "π"}, {"ln", "log", "√", "e"}, {"x²", "xʸ", "1/x", "x!"}};
        for (String[] row : more) {
            LinearLayout strip = new LinearLayout(context);
            for (String label : row) strip.addView(key(label, () -> press(label)), new LayoutParams(0, -1, 1));
            science.addView(strip, new LayoutParams(-1, 0, 1));
        }
        addView(science, new LayoutParams(-1, 0, .40f)); science.setVisibility(GONE);
        TextView resize = new TextView(context); resize.setText("◢"); resize.setGravity(Gravity.END); resize.setTextSize(12);
        resize.setContentDescription("Resize calculator"); resize.setOnTouchListener((view, event) -> gesture(event, "resize"));
        addView(resize, new LayoutParams(-1, dp(18))); theme(false);
    }
    void interactionEnabled(boolean value) { interactionEnabled = value; }
    @Override public boolean dispatchTouchEvent(MotionEvent event) {
        return interactionEnabled && super.dispatchTouchEvent(event);
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView line(Context context) {
        TextView text = new TextView(context); text.setGravity(Gravity.END | Gravity.CENTER_VERTICAL); text.setSingleLine(true); text.setTypeface(Typeface.MONOSPACE); return text;
    }
    private Button key(String label, Runnable action) {
        Button button = new Button(getContext()); button.setText(label); button.setAllCaps(false); button.setMinWidth(0); button.setMinimumWidth(0); button.setMinHeight(0); button.setMinimumHeight(0); button.setPadding(1, 0, 1, 0);
        button.setContentDescription(label); button.setOnClickListener(view -> { action.run(); revision++; }); controls.add(button); return button;
    }
    private boolean gesture(MotionEvent event, String mode) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: downX = event.getRawX(); downY = event.getRawY(); events.action(mode + "-start", 0, 0); return true;
            case MotionEvent.ACTION_MOVE: events.action(mode, event.getRawX() - downX, event.getRawY() - downY); return true;
            case MotionEvent.ACTION_UP: events.action(mode + "-end", event.getRawX() - downX, event.getRawY() - downY); return true;
            case MotionEvent.ACTION_CANCEL: events.action("cancel", 0, 0); return true;
            default: return true;
        }
    }
    void theme(boolean value) {
        dark = value; setBackgroundColor(dark ? Color.rgb(28, 28, 30) : Color.rgb(250, 250, 250));
        int color = dark ? Color.WHITE : Color.rgb(25, 25, 25);
        history.setTextColor(color); input.setTextColor(color); result.setTextColor(color);
        for (Button button : controls) button.setTextColor(color);
        ((TextView)header.getChildAt(0)).setTextColor(color);
    }
    private void mode(boolean value) {
        scientific = value; science.setVisibility(value ? VISIBLE : GONE);
        ((LayoutParams)keypad.getLayoutParams()).weight = value ? .43f : .70f; requestLayout();
    }
    private void press(String label) {
        if (label.equals("AC")) { expression = ""; lastResult = "0"; previous = ""; finished = false; error = false; }
        else if (label.equals("DEG/RAD")) { degrees = !degrees; controls.stream().filter(button -> button.getText().toString().matches("DEG/RAD|DEG|RAD")).findFirst().ifPresent(button -> button.setText(degrees ? "DEG" : "RAD")); }
        else if (label.equals("Inv")) inverse = !inverse;
        else if (label.equals("⌫")) { if (error) { expression = ""; error = false; } else if (!expression.isEmpty()) expression = expression.substring(0, expression.length() - 1); finished = false; }
        else if (label.equals("=")) {
            try { lastResult = evaluate(expression, degrees); previous = expression + " ="; expression = lastResult; finished = true; error = false; }
            catch (RuntimeException failure) { error = true; lastResult = "Math error"; }
        } else {
            if (error) { expression = ""; error = false; }
            boolean operator = "+−×÷%^".contains(label);
            if (finished && !operator) expression = ""; finished = false;
            String value;
            switch (label) {
                case "sin": case "cos": case "tan": value = (inverse ? "a" : "") + label + "("; break;
                case "ln": value = "log("; break;
                case "log": value = "log10("; break;
                case "√": value = "sqrt("; break;
                case "x²": value = "^2"; break;
                case "xʸ": value = "^"; break;
                case "x!": expression = "fact(" + (expression.isEmpty() ? "0" : expression) + ")"; value = ""; break;
                case "1/x": expression = "1/(" + (expression.isEmpty() ? "0" : expression) + ")"; value = ""; break;
                case "+/−": expression = "-(" + (expression.isEmpty() ? "0" : expression) + ")"; value = ""; break;
                default: value = label;
            }
            if (expression.length() + value.length() > 500) return;
            expression += value;
            try { lastResult = evaluate(expression, degrees); } catch (RuntimeException incomplete) { /* Keep the last valid preview while input is incomplete. */ }
        }
        history.setText(previous); input.setText(expression); result.setText(lastResult);
    }
    static String evaluate(String text, boolean degrees) {
        if (text == null || text.isEmpty() || text.length() > 500) throw new IllegalArgumentException("Invalid calculation");
        String source = text.replace('×', '*').replace('÷', '/').replace('−', '-').replace("π", "pi");
        ExpressionBuilder builder = new ExpressionBuilder(source).function(new Function("fact") {
            @Override public double apply(double... args) {
                double value = args[0]; if (value < 0 || value > 170 || value != Math.rint(value)) throw new ArithmeticException("Invalid factorial");
                double result = 1; for (int i = 2; i <= (int)value; i++) result *= i; return result;
            }
        });
        if (degrees) {
            for (String name : new String[]{"sin", "cos", "tan", "asin", "acos", "atan"}) builder.function(new Function(name) {
                @Override public double apply(double... args) {
                    double x = args[0];
                    switch (getName()) {
                        case "sin": return Math.sin(Math.toRadians(x)); case "cos": return Math.cos(Math.toRadians(x)); case "tan": return Math.tan(Math.toRadians(x));
                        case "asin": return Math.toDegrees(Math.asin(x)); case "acos": return Math.toDegrees(Math.acos(x)); default: return Math.toDegrees(Math.atan(x));
                    }
                }
            });
        }
        double value = builder.build().evaluate();
        if (!Double.isFinite(value)) throw new ArithmeticException("No finite result");
        return BigDecimal.valueOf(value).round(new MathContext(12)).stripTrailingZeros().toPlainString();
    }
    @Override protected void onSizeChanged(int width, int height, int oldWidth, int oldHeight) {
        super.onSizeChanged(width, height, oldWidth, oldHeight);
        float density = getResources().getDisplayMetrics().scaledDensity;
        float text = Math.max(8, Math.min(width / 9f, height / (scientific ? 24f : 18f))) / density;
        for (Button button : controls) button.setTextSize(text);
        result.setTextSize(Math.max(12, Math.min(width / 6f, height / 10f)) / density);
        input.setTextSize(Math.max(8, Math.min(width / 14f, height / 25f)) / density); history.setTextSize(input.getTextSize() / density);
    }
    JSObject state(float scale) {
        JSArray buttons = new JSArray();
        for (int i = 0; i < controls.size(); i++) {
            Button button = controls.get(i); if (!button.isShown()) continue;
            buttons.put(new JSObject().put("id", "c" + i).put("label", button.getText().toString()).put("type", "button").put("disabled", !button.isEnabled()).put("value", ""));
        }
        return new JSObject().put("version", String.valueOf(revision)).put("title", "Calculator")
            .put("viewport", new JSObject().put("width", getWidth() / scale).put("height", getHeight() / scale))
            .put("offset", 0).put("total", buttons.length()).put("controls", buttons)
            .put("outputs", new JSArray().put(previous).put(expression).put(lastResult)).put("truncated", false);
    }
    void pressControl(String version, String id) {
        if (!String.valueOf(revision).equals(version) || !id.matches("c[0-9]{1,2}")) throw new IllegalArgumentException("Calculator controls changed; inspect again");
        int index = Integer.parseInt(id.substring(1));
        if (index >= controls.size() || !controls.get(index).isShown() || !controls.get(index).isEnabled()) throw new IllegalArgumentException("Calculator control unavailable");
        controls.get(index).performClick();
    }
}
