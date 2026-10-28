package com.axiom2.android;

import android.content.Context;
import android.view.MotionEvent;
import android.widget.FrameLayout;
import java.util.function.IntConsumer;

/** Only owns loading/error gestures. Web content uses its DOM-aware gesture bridge. */
final class ConnectionSwipeLayout extends FrameLayout {
    interface StartGate { boolean allowed(float x, float y); }
    private final StartGate gate;
    private final IntConsumer swipe;
    private ConnectionSwipeGesture gesture;
    private boolean claimed;

    ConnectionSwipeLayout(Context context, StartGate gate, IntConsumer swipe) { super(context); this.gate = gate; this.swipe = swipe; }
    void cancelGesture() { if (gesture != null) gesture.cancel(); }
    private boolean finish(MotionEvent event) {
        int direction = gesture == null ? 0 : gesture.finish(event.getX(), event.getY(), event.getEventTime());
        if (direction != 0) swipe.accept(direction);
        return direction != 0;
    }
    @Override public boolean onInterceptTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                cancelGesture(); claimed = false;
                if (gate.allowed(event.getX(), event.getY()) && event.getPointerCount() == 1) {
                    gesture = new ConnectionSwipeGesture(getResources().getDisplayMetrics().density, getWidth());
                    gesture.start(event.getX(), event.getY(), event.getEventTime());
                }
                return false;
            case MotionEvent.ACTION_MOVE:
                if (gesture != null && gesture.move(event.getX(), event.getY(), event.getEventTime(), event.getPointerCount())) { claimed = true; return true; }
                break;
            case MotionEvent.ACTION_UP: return finish(event);
            case MotionEvent.ACTION_POINTER_DOWN:
            case MotionEvent.ACTION_CANCEL: cancelGesture(); break;
        }
        return false;
    }
    @Override public boolean onTouchEvent(MotionEvent event) {
        if (!claimed) return super.onTouchEvent(event);
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_MOVE: if (gesture != null) gesture.move(event.getX(), event.getY(), event.getEventTime(), event.getPointerCount()); break;
            case MotionEvent.ACTION_UP: finish(event); break;
            case MotionEvent.ACTION_POINTER_DOWN:
            case MotionEvent.ACTION_CANCEL: cancelGesture(); break;
        }
        return true;
    }
}
