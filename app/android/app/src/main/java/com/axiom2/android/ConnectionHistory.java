package com.axiom2.android;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Successful endpoints, in the same order used by the native connection chooser. */
final class ConnectionHistory {
    private static final int LIMIT = 8;

    static List<String> entries(String saved) {
        LinkedHashSet<String> unique = new LinkedHashSet<>();
        for (String entry : saved.split("\n")) {
            String endpoint = entry.trim();
            if (!endpoint.isEmpty() && unique.size() < LIMIT) unique.add(endpoint);
        }
        return new ArrayList<>(unique);
    }

    static String next(String saved, String current) {
        List<String> history = entries(saved);
        return history.isEmpty() ? "" : history.get((history.indexOf(current) + 1) % history.size());
    }

    static String record(String saved, String endpoint, boolean cycling) {
        List<String> history = entries(saved);
        // A cycle must not reorder the ring: moving B to the front of A,B,C would send B back to A.
        if (!cycling || !history.contains(endpoint)) {
            history.remove(endpoint);
            history.add(0, endpoint);
        }
        return String.join("\n", history.subList(0, Math.min(LIMIT, history.size())));
    }
}
