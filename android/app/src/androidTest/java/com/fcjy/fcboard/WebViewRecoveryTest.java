package com.fcjy.fcboard;

import static org.junit.Assert.*;
import static androidx.test.espresso.Espresso.onView;
import static androidx.test.espresso.action.ViewActions.click;
import static androidx.test.espresso.assertion.ViewAssertions.matches;
import static androidx.test.espresso.matcher.ViewMatchers.isDisplayed;
import static androidx.test.espresso.matcher.ViewMatchers.withText;
import static androidx.test.espresso.matcher.RootMatchers.isDialog;

import android.os.SystemClock;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class WebViewRecoveryTest {
    private void onActivity(ActivityScenario<MainActivity> scenario, ActivityScenario.ActivityAction<MainActivity> action) {
        androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            .runOnMainSync(() -> scenario.onActivity(action));
    }

    private void stopRenderer(MainActivity activity) {
        WebView original = activity.getBridge().getWebView();
        RenderProcessGoneDetail stopped = new RenderProcessGoneDetail() {
            @Override public boolean didCrash() { return false; }
            @Override public int rendererPriorityAtExit() { return WebView.RENDERER_PRIORITY_IMPORTANT; }
        };
        android.webkit.WebViewClient client = original.getWebViewClient();
        assertTrue(client.onRenderProcessGone(original, stopped));
        assertTrue(client.onRenderProcessGone(original, stopped));
        assertNull(original.getParent());
    }

    private MainActivity awaitReplacement(ActivityScenario<MainActivity> scenario, MainActivity previous) {
        AtomicReference<MainActivity> current = new AtomicReference<>();
        for (int attempt = 0; attempt < 100; attempt++) {
            onActivity(scenario, current::set);
            if (current.get() != previous) return current.get();
            SystemClock.sleep(50);
        }
        fail("Renderer recovery must create a new Activity and WebView");
        return null;
    }

    @Test public void failedMainRendererWaitsForExplicitRetryWithoutRestarting() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicReference<MainActivity> first = new AtomicReference<>();
            onActivity(scenario, activity -> { first.set(activity); stopRenderer(activity); });
            onView(withText(R.string.webview_recovery_message)).inRoot(isDialog()).check(matches(isDisplayed()));
            onActivity(scenario, activity -> assertSame("A failed renderer must never silently restart the board", first.get(), activity));
            onView(withText(R.string.web_reload)).inRoot(isDialog()).perform(click());
            MainActivity recovered = awaitReplacement(scenario, first.get());
            onActivity(scenario, activity -> {
                assertSame(recovered, activity);
                assertNotNull(activity.getBridge().getWebView().getParent());
                stopRenderer(activity);
            });
            onView(withText(R.string.webview_recovery_message)).inRoot(isDialog()).check(matches(isDisplayed()));
            onActivity(scenario, activity -> assertSame("Repeated failure must not loop through Activities", recovered, activity));
            onView(withText(R.string.web_reload)).inRoot(isDialog()).perform(click());
            MainActivity retried = awaitReplacement(scenario, recovered);
            onActivity(scenario, activity -> {
                assertSame(retried, activity);
                assertNotNull(activity.getBridge().getWebView().getParent());
            });
        }
    }
}
