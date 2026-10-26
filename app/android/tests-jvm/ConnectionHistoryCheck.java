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
        System.out.println("PASS: " + passed + " connection history assertions");
    }
}
