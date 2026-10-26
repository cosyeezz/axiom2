function mll(A) { for (let e of A) {
    let A = $ue(e.isQueued), t = th(e.waitTime);
    if (!0 !== A && void 0 === t)
        continue;
    let i = { isQueued: A, modelKey: a1(e.modelKey), queueCount: th(e.queueCount), queueType: a1(e.queueType), serviceAvailable: $ue(e.serviceAvailable), retryAfterSeconds: th(e.retryAfterSeconds), waitTime: t };
    return Object.fromEntries(Object.entries(i).filter(([, A]) => void 0 !== A));
} }
