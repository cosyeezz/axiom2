package com.axiom2.android;

import java.util.Arrays;

/** Run with the production ConnectionHistory class; no Android runtime or test dependencies. */
public final class ConnectionHistoryCheck {
    private static final String A = "http://100.64.0.1:4317", B = "http://100.64.0.2:4317", C = "http://100.64.0.3:4317";
    private static int passed;
    private static void equal(Object actual, Object expected) {
        if (!actual.equals(expected)) throw new AssertionError("Expected " + expected + ", got " + actual);
        passed++;
    }
    public static void main(String[] args) {
        String saved = String.join("\n", A, B, C), current = A;
        for (String expected : new String[]{B, C, A, B, C, A, B, C, A}) {
            current = ConnectionHistory.next(saved, current);
            equal(current, expected);
            saved = ConnectionHistory.record(saved, current, true);
            equal(saved, String.join("\n", A, B, C));
        }
        current = A;
        for (String expected : new String[]{C, B, A, C, B, A}) {
            current = ConnectionHistory.next(saved, current, -1);
            equal(current, expected);
            saved = ConnectionHistory.record(saved, current, true);
            equal(saved, String.join("\n", A, B, C));
        }
        equal(ConnectionHistory.next(saved, A, -1), C);
        equal(ConnectionHistory.next(saved, C, 1), A);
        equal(ConnectionHistory.next(saved, "not-in-history", -1), C);
        equal(ConnectionHistory.next("", A, -1), "");
        equal(ConnectionHistory.next(A, A, -1), A);
        equal(ConnectionHistory.next("", A), "");
        equal(ConnectionHistory.next(A, A), A);
        equal(ConnectionHistory.next(A + "\n" + B, B), A);
        equal(ConnectionHistory.next(saved, "not-in-history"), A);
        equal(ConnectionHistory.entries("\n " + A + " \n\n" + A + "\n" + B), Arrays.asList(A, B));
        equal(ConnectionHistory.record(saved, B, false), String.join("\n", B, A, C));
        equal(ConnectionHistory.record("", A, false), A);
        equal(ConnectionHistory.record(A, B, true), B + "\n" + A);
        String many = "";
        for (int i = 1; i <= 12; i++) many = ConnectionHistory.record(many, "http://100.64.0." + i + ":4317", false);
        equal(ConnectionHistory.entries(many).size(), 8);
        equal(ConnectionHistory.entries(many).get(0), "http://100.64.0.12:4317");
        equal(ConnectionHistory.entries(many).get(7), "http://100.64.0.5:4317");
        equal(ConnectionHistory.record(many, "http://100.64.0.6:4317", true), many);
        gestures();
        System.out.println("PASS: " + passed + " connection history and gesture assertions");
    }
    private static void gestures() {
        ConnectionSwipeGesture gesture = new ConnectionSwipeGesture(2, 800);
        gesture.start(600, 200, 1000);
        equal(gesture.move(550, 203, 1100, 1), true);
        equal(gesture.finish(400, 210, 1250), 1);
        equal(gesture.finish(400, 210, 1260), 0); // One gesture, one switch.
        gesture.start(200, 200, 2000);
        equal(gesture.finish(400, 210, 2250), -1);
        gesture.start(600, 200, 3000);
        equal(gesture.finish(500, 205, 3250), 0); // Short drag.
        gesture.start(600, 200, 4000);
        equal(gesture.move(590, 260, 4100, 1), false);
        equal(gesture.finish(350, 270, 4300), 0); // Vertical direction stays locked.
        gesture.start(600, 200, 5000);
        gesture.move(550, 205, 5100, 2);
        equal(gesture.finish(350, 205, 5300), 0);
        gesture.start(600, 200, 6000); gesture.cancel();
        equal(gesture.finish(350, 205, 6300), 0);
        gesture.start(600, 200, 7000);
        equal(gesture.finish(350, 205, 8300), 0); // Long press / text selection.
        gesture.start(600, 200, 9000);
        equal(gesture.finish(350, 420, 9300), 0); // Diagonal, not a horizontal swipe.
        gesture.start(600, 200, 10000);
        equal(gesture.finish(350, 205, 9900), 0);
    }
}
