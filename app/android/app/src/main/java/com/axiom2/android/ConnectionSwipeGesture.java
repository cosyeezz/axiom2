package com.axiom2.android;

/** Single-finger gesture state for the native loading/error page. Coordinates are pixels. */
final class ConnectionSwipeGesture {
    private final float slop, distance;
    private float x, y;
    private long time;
    private boolean tracking, horizontal;

    ConnectionSwipeGesture(float density, float width) {
        slop = 12 * density;
        distance = Math.max(64 * density, Math.min(width * .18f, 100 * density));
    }
    void start(float x, float y, long time) { this.x = x; this.y = y; this.time = time; tracking = true; horizontal = false; }
    void cancel() { tracking = horizontal = false; }
    boolean move(float x, float y, long time, int pointers) {
        if (!tracking) return false;
        if (pointers != 1 || time - this.time > 1200 || time < this.time) { cancel(); return false; }
        float dx = Math.abs(x - this.x), dy = Math.abs(y - this.y);
        if (!horizontal && dy >= slop && dy >= dx) { cancel(); return false; }
        if (dx >= slop && dx > dy * 1.5f) horizontal = true;
        return horizontal;
    }
    int finish(float x, float y, long time) {
        move(x, y, time, 1);
        int direction = tracking && horizontal && Math.abs(x - this.x) >= distance && Math.abs(x - this.x) > Math.abs(y - this.y) * 1.5f ? (x < this.x ? 1 : -1) : 0;
        cancel(); return direction;
    }
}
