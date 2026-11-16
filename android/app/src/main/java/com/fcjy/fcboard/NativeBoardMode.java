package com.fcjy.fcboard;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import java.util.function.IntSupplier;

/** HWhiteBoard's verified board-mode protocol. Side-board coordinates are mapped by firmware. */
final class NativeBoardMode {
    private static final Uri SETTINGS = Uri.parse("content://com.bsd.systemservice.db.sourceContentProvider/tbl_Settings");
    private final Context context;
    private final IntSupplier customer;
    private String previous;
    private boolean entered, doubleScreen, navigation;
    NativeBoardMode(Context context) { this(context, NativeBoardMode::customer); }
    NativeBoardMode(Context context, IntSupplier customer) { this.context = context; this.customer = customer; }
    private static int customer() {
        try {
            return (Integer) Class.forName("android.os.SystemProperties").getMethod("getInt", String.class, int.class)
                .invoke(null, "persist.sys.customer.hw", 0);
        } catch (ReflectiveOperationException | SecurityException unavailable) { return 0; }
    }
    private void command(String value) {
        context.sendBroadcast(new Intent("broadcast.beststar.action.setCommand").putExtra("command", value));
    }
    void foreground(boolean visible) {
        if (visible == entered) return;
        entered = visible;
        boolean bsd = false;
        try {
            android.content.ContentResolver resolver = context.getContentResolver();
            try (Cursor cursor = resolver.query(SETTINGS, new String[]{"whiteboard_state"}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    String current = cursor.getString(cursor.getColumnIndexOrThrow("whiteboard_state"));
                    bsd = "0".equals(current) || "1".equals(current);
                    String next = visible ? "1" : previous;
                    if (bsd && next != null && (visible || "1".equals(current))) {
                        ContentValues values = new ContentValues(); values.put("whiteboard_state", next);
                        if (resolver.update(SETTINGS, values, null, null) > 0 && visible) previous = current;
                    }
                }
            }
        } catch (Exception unavailable) {
            android.util.Log.d("NativeInk", "Vendor board mode unavailable: " + unavailable.getClass().getSimpleName());
        }
        if (visible) {
            // ZWhiteBoardActivity.onStart: CUSTOM=14 needs this command in addition
            // to whiteboard_state. A missing provider must not skip the mapping command.
            if (customer.getAsInt() == 14) { command("SetDoubleScreen"); doubleScreen = true; }
            if (bsd || doubleScreen) {
                context.sendBroadcast(new Intent("broadcast.navigation.touch_off")); navigation = true;
            }
            android.util.Log.i("NativeInk", "Board hardware mode active: provider=" + bsd + ", mappedSideBoard=" + doubleScreen + ", navigationOwned=" + navigation);
        } else {
            if (doubleScreen) { command("SetSingleScreen"); doubleScreen = false; }
            if (navigation) { context.sendBroadcast(new Intent("broadcast.navigation.touch_on")); navigation = false; }
            previous = null;
        }
    }
}
