function Got(A) { let e; if (A.startsWith(xhA))
    e = A.slice(xhA.length);
else if (A.includes(xhA))
    try {
        let t = JSON.parse(A);
        t.body?.startsWith(xhA) && (e = t.body.slice(xhA.length));
    }
    catch { } if (void 0 !== e) {
    if (!e)
        return null;
    try {
        let A = JSON.parse(e);
        return A.notifications?.length ? A.notifications : null;
    }
    catch {
        return C.warn(`[NotificationExtractor] Failed to parse notification payload: ${e.slice(0, 200)}`), null;
    }
} }
