package com.fcjy.fcboard;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import java.util.function.IntSupplier;

/** Firmware maps both physical sideboards while the whiteboard is in the foreground.
 * Protocol: reference ZWhiteBoardActivity.onStart/onStop and DBTools.SETTINGS_URI. */
final class NativeBoardMode {
    interface Settings {
        String read();
        boolean write(String value);
    }

    private static final Uri SETTINGS = Uri.parse(
        "content://com.bsd.systemservice.db.sourceContentProvider/tbl_Settings");
    private final Context context;
    private final IntSupplier customer;
    private final Settings settings;
    private String previous;
    private boolean entered, doubleScreen, navigation;

    NativeBoardMode(Context context) {
        this(context, NativeBoardMode::customer, new Settings() {
            @Override public String read() {
                try (Cursor cursor = context.getContentResolver().query(
                        SETTINGS, new String[]{"whiteboard_state"}, null, null, null)) {
                    return cursor != null && cursor.moveToFirst()
                        ? cursor.getString(cursor.getColumnIndexOrThrow("whiteboard_state")) : null;
                }
            }
            @Override public boolean write(String value) {
                ContentValues values = new ContentValues();
                values.put("whiteboard_state", value);
                return context.getContentResolver().update(SETTINGS, values, null, null) > 0;
            }
        });
    }

    NativeBoardMode(Context context, IntSupplier customer, Settings settings) {
        this.context = context;
        this.customer = customer;
        this.settings = settings;
    }

    private static int customer() {
        try {
            return (Integer) Class.forName("android.os.SystemProperties")
                .getMethod("getInt", String.class, int.class)
                .invoke(null, "persist.sys.customer.hw", 0);
        } catch (ReflectiveOperationException | SecurityException unavailable) {
            return 0;
        }
    }

    private boolean broadcast(Intent intent) {
        try {
            context.sendBroadcast(intent);
            return true;
        } catch (SecurityException unavailable) {
            android.util.Log.w("NativeInk", "Firmware board command denied: " + intent.getAction());
            return false;
        }
    }

    private boolean command(String value) {
        return broadcast(new Intent("broadcast.beststar.action.setCommand").putExtra("command", value));
    }

    void foreground(boolean visible) {
        if (visible == entered) return;
        entered = visible;
        boolean provider = false;
        try {
            String current = settings.read();
            provider = "0".equals(current) || "1".equals(current);
            if (visible && provider) {
                if (settings.write("1")) previous = current;
            } else if (!visible && previous != null && "1".equals(current)) {
                settings.write(previous);
            }
        } catch (Exception unavailable) {
            android.util.Log.d("NativeInk", "Firmware board state unavailable: "
                + unavailable.getClass().getSimpleName());
        }
        if (visible) {
            // CUSTOM=14 requires the sideboard mapping command even without a provider.
            if (customer.getAsInt() == 14) doubleScreen = command("SetDoubleScreen");
            if (provider || doubleScreen) {
                navigation = broadcast(new Intent("broadcast.navigation.touch_off"));
            }
            android.util.Log.i("NativeInk", "Board hardware mode active: provider=" + provider
                + ", mappedSideBoard=" + doubleScreen + ", navigationOwned=" + navigation);
        } else {
            if (doubleScreen) { command("SetSingleScreen"); doubleScreen = false; }
            if (navigation) { broadcast(new Intent("broadcast.navigation.touch_on")); navigation = false; }
            previous = null;
        }
    }
}
