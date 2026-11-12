package com.fcjy.fcboard;

import org.junit.Test;
import static org.junit.Assert.*;

public class NativeCalculatorTest {
    @Test public void computesRealBasicAndScientificExamples() {
        String[][] examples = {{"9+9", "18"}, {"1.2+1.3", "2.5"}, {"1/2+1/2", "1"}, {"12÷3", "4"}, {"2^2", "4"}, {"log2(4)", "2"}, {"fact(5)", "120"}};
        for (String[] example : examples) assertEquals(example[0], example[1], NativeCalculatorView.evaluate(example[0], false));
        assertEquals("0.5", NativeCalculatorView.evaluate("sin(30)", true));
    }
    @Test public void rejectsInvalidOrNonFiniteInput() {
        for (String input : new String[]{"1/0", "sqrt(-1)", "fact(100000)", "2+", "unknown(4)"}) {
            try { NativeCalculatorView.evaluate(input, false); fail(input); } catch (RuntimeException expected) { }
        }
    }
}
