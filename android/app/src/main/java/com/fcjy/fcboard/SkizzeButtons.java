package com.fcjy.fcboard;

/** ButtonEvent's 500ms press/release/double-click timing, independently owned by each input. */
final class SkizzeButtons implements AutoCloseable {
    interface Timer {
        void after(Runnable task, long milliseconds);
        void cancel(Runnable task);
    }
    interface Listener { void click(int button, boolean twice); }
    private final Click down;
    private final Click up;
    private final Click shortcut;
    private final Click sensory;
    private int active;
    private boolean chord;

    SkizzeButtons(Timer timer, Listener listener) {
        down = new Click(timer, twice -> listener.click(4, twice));
        up = new Click(timer, twice -> listener.click(8, twice));
        shortcut = new Click(timer, twice -> listener.click(32, twice));
        sensory = new Click(timer, twice -> listener.click(0, twice));
    }
    void raw(int flags) {
        int buttons = flags & 44;
        if (buttons == 0) {
            if (active != 0) button(active).accept(false);
            active = 0;
            chord = false;
        } else if (!chord && Integer.bitCount(buttons) == 1 && (active == 0 || active == buttons)) {
            active = buttons;
            button(buttons).accept(true);
        } else {
            if (active != 0) button(active).reset();
            active = 0;
            chord = true;
        }
    }
    void sensory(int state, int attitude) {
        if (attitude == 2 && (state == 0 || state == 1)) sensory.accept(state == 1);
        else sensory.reset();
    }
    private Click button(int flags) { return flags == 4 ? down : flags == 8 ? up : shortcut; }
    @Override public void close() {
        active = 0; chord = false; down.reset(); up.reset(); shortcut.reset(); sensory.reset();
    }

    private interface Action { void click(boolean twice); }
    private static final class Click {
        private final Timer timer;
        private final Action action;
        private final Runnable single;
        private boolean down;
        private boolean waiting;
        Click(Timer timer, Action action) {
            this.timer = timer; this.action = action;
            single = () -> { waiting = false; action.click(false); };
        }
        void accept(boolean pressed) {
            if (pressed) { down = true; return; }
            if (!down) return;
            down = false;
            if (waiting) {
                timer.cancel(single); waiting = false; action.click(true);
            } else {
                waiting = true; timer.after(single, 500);
            }
        }
        void reset() { down = false; waiting = false; timer.cancel(single); }
    }
}
