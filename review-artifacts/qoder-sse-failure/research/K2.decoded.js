function K2(A, e, t) { if (LEA(A))
    return null; let i = JSON.parse(A); if (void 0 !== i.statusCodeValue && void 0 !== i.body) {
    let A = i;
    if (200 !== A.statusCodeValue && "finish" !== e) {
        let e = yw(String(A.body));
        C.error(`[PayloadParser] SSE event #${t}${": Qoder API error: statusCode="}${A.statusCode}, statusCodeValue=${A.statusCodeValue}, body(first 3000)=${e.slice(0, 3e3)}`);
        let i = Ntt({ status: A.statusCode, statusCode: A.statusCodeValue, body: e }), r = A.statusCodeValue, n = !1, o = !1;
        if (i.code === c1 ? r = 401 : i.code === Oxn ? n = !0 : ede(i) && (o = !0), !i.code) {
            let A = e.toLowerCase();
            (A.includes("login expired") || A.includes("login timeout")) && (r = 401);
        }
        let s = eK(i);
        throw Object.assign(new Error(`Qoder API error: ${A.statusCode} - ${e}`), { status: r, duplicateRequest: n, modelQueued: o, ...void 0 !== s ? { retryAfterMs: s } : {}, qoderApiError: i });
    }
    let r = A.body?.trim() ?? "";
    if (!r || LEA(r))
        return null;
    try {
        return JSON.parse(r);
    }
    catch (A) {
        throw C.error(`[PayloadParser] SSE event #${t}${": Failed to parse wrapper.body as JSON. error="}${A instanceof Error ? A.message : String(A)}, body(first 5000)=${r.slice(0, 5e3)}`), A;
    }
} return i; }
