function r$l(A) { if (A.startsWith(vwA))
    return A.slice(vwA.length); if (A.includes(vwA))
    try {
        let e = JSON.parse(A);
        if (e.body?.startsWith(vwA))
            return e.body.slice(vwA.length);
    }
    catch { } }
