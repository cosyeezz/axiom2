# Exact numbered evidence excerpts

Line numbers are 1-based in the original input, not this excerpt file. No fetched code was executed.

## W: [02-pinned-wrapper.body](/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-04/browser-results/02-pinned-wrapper.body)

### Original lines 64-90
```text
64: coalition_create_syscall(user_addr_t cidp, uint32_t flags)
65: {
66: 	int error = 0;
67: 	kern_return_t kr;
68: 	uint64_t cid;
69: 	coalition_t coal;
70: 	int type = COALITION_CREATE_FLAGS_GET_TYPE(flags);
71: 	int role = COALITION_CREATE_FLAGS_GET_ROLE(flags);
72: 	boolean_t privileged = !!(flags & COALITION_CREATE_FLAGS_PRIVILEGED);
73: 	boolean_t efficient = !!(flags & COALITION_CREATE_FLAGS_EFFICIENT);
74: 
75: 	if ((flags & (~COALITION_CREATE_FLAGS_MASK)) != 0) {
76: 		return EINVAL;
77: 	}
78: 	if (type < 0 || type > COALITION_TYPE_MAX) {
79: 		return EINVAL;
80: 	}
81: 
82: 	kr = coalition_create_internal(type, role, privileged, efficient, &coal, &cid);
83: 	if (kr != KERN_SUCCESS) {
84: 		/* for now, the only kr is KERN_RESOURCE_SHORTAGE */
85: 		error = ENOMEM;
86: 		goto out;
87: 	}
88: 
89: 	coal_dbg("(addr, %u) -> %llu", flags, cid);
90: 	error = copyout(&cid, cidp, sizeof(cid));
```

### Original lines 95-153
```text
95: /*
96:  * Request to terminate the coalition identified by ID.
97:  * Attempts to spawn into this coalition using the posix_spawnattr will begin
98:  * failing. Processes already within the coalition may still fork.
99:  * Arms the 'coalition is empty' notification when the coalition's active
100:  * count reaches zero.
101:  *
102:  * Returns:
103:  * ESRCH	No coalition with that ID could be found.
104:  * EALREADY	The coalition with that ID has already been terminated.
105:  * EFAULT	cidp parameter pointed to invalid memory.
106:  * EPERM	Caller doesn't have permission to terminate that coalition.
107:  */
108: static
109: int
110: coalition_request_terminate_syscall(user_addr_t cidp, uint32_t flags)
111: {
112: 	kern_return_t kr;
113: 	int error = 0;
114: 	uint64_t cid;
115: 	coalition_t coal;
116: 
117: 	if (flags != 0) {
118: 		return EINVAL;
119: 	}
120: 
121: 	error = copyin(cidp, &cid, sizeof(cid));
122: 	if (error) {
123: 		return error;
124: 	}
125: 
126: 	coal = coalition_find_by_id(cid);
127: 	if (coal == COALITION_NULL) {
128: 		return ESRCH;
129: 	}
130: 
131: 	kr = coalition_request_terminate_internal(coal);
132: 	coalition_release(coal);
133: 
134: 	switch (kr) {
135: 	case KERN_SUCCESS:
136: 		break;
137: 	case KERN_DEFAULT_SET:
138: 		error = EPERM;
139: 		break;
140: 	case KERN_TERMINATED:
141: 		error = EALREADY;
142: 		break;
143: 	case KERN_INVALID_NAME:
144: 		error = ESRCH;
145: 		break;
146: 	default:
147: 		error = EIO;
148: 		break;
149: 	}
150: 
151: 	coal_dbg("(%llu, %u) -> %d", cid, flags, error);
152: 
153: 	return error;
```

### Original lines 220-249
```text
220: /* Syscall demux.
221:  * Returns EPERM if the calling process is not privileged to make this call.
222:  */
223: int
224: coalition(proc_t p, struct coalition_args *cap, __unused int32_t *retval)
225: {
226: 	uint32_t operation = cap->operation;
227: 	user_addr_t cidp = cap->cid;
228: 	uint32_t flags = cap->flags;
229: 	int error = 0;
230: 	int type = COALITION_CREATE_FLAGS_GET_TYPE(flags);
231: 
232: 	if (!task_is_in_privileged_coalition(proc_task(p), type)) {
233: 		return EPERM;
234: 	}
235: 
236: 	switch (operation) {
237: 	case COALITION_OP_CREATE:
238: 		error = coalition_create_syscall(cidp, flags);
239: 		break;
240: 	case COALITION_OP_REAP:
241: 		error = coalition_reap_syscall(cidp, flags);
242: 		break;
243: 	case COALITION_OP_TERMINATE:
244: 		error = coalition_request_terminate_syscall(cidp, flags);
245: 		break;
246: 	default:
247: 		error = ENOSYS;
248: 	}
249: 	return error;
```

### Original lines 426-444
```text
426: 	uint32_t operation = uap->operation;
427: 	int error;
428: 	uint64_t cid;
429: 	coalition_t coal = COALITION_NULL;
430: 
431: 	if (!kauth_cred_issuser(kauth_cred_get())) {
432: 		error = EPERM;
433: 		goto out;
434: 	}
435: 
436: 	error = copyin(cidp, &cid, sizeof(cid));
437: 	if (error) {
438: 		goto out;
439: 	}
440: 
441: 	coal = coalition_find_by_id(cid);
442: 	if (coal == COALITION_NULL) {
443: 		error = ESRCH;
444: 		goto out;
```

### Original lines 528-540
```text
528: 	coalition_policy_flavor_t flavor = uap->flavor;
529: 	uint32_t value = uap->value;
530: 
531: 	int error = 0;
532: 
533: 	if (!IOTaskHasEntitlement(proc_task(p), COALITION_POLICY_ENTITLEMENT)) {
534: 		return EPERM;
535: 	}
536: 
537: 	coalition_t coal = coalition_find_by_id(cid);
538: 	if (coal == COALITION_NULL) {
539: 		return ESRCH;
540: 	}
```

## U: [01-user-header.body](/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-05/browser-results/01-user-header.body)

### Original lines 38-54
```text
38: __BEGIN_DECLS
39: 
40: #ifndef KERNEL
41: /* Userspace syscall prototypes */
42: 
43: /* Syscalls */
44: int coalition_create(uint64_t *cid_out, uint32_t flags);
45: int coalition_terminate(uint64_t cid, uint32_t flags);
46: int coalition_reap(uint64_t cid, uint32_t flags);
47: 
48: /* Wrappers around __coalition_info syscall (with proper struct types) */
49: int coalition_info_resource_usage(uint64_t cid, struct coalition_resource_usage *cru, size_t sz);
50: int coalition_info_set_name(uint64_t cid, const char *name, size_t size);
51: int coalition_info_set_efficiency(uint64_t cid, uint64_t flags);
52: int coalition_ledger_set_logical_writes_limit(uint64_t cid, int64_t limit);
53: 
54: #ifdef PRIVATE
```

## P: [02-private-header.body](/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-05/browser-results/02-private-header.body)

### Original lines 36-54
```text
36: __BEGIN_DECLS
37: 
38: #define COALITION_POLICY_ENTITLEMENT "com.apple.private.coalition-policy"
39: 
40: __enum_decl(coalition_policy_flavor_t, uint32_t, {
41: 	COALITION_POLICY_SUPPRESS = 1,
42: });
43: 
44: __enum_decl(coalition_policy_suppress_t, uint32_t, {
45: 	COALITION_POLICY_SUPPRESS_NONE = 0,
46: 	COALITION_POLICY_SUPPRESS_DARWIN_BG = 1,
47: });
48: 
49: #ifndef KERNEL
50: /* Userspace syscall prototypes */
51: int coalition_policy_set(uint64_t cid, coalition_policy_flavor_t flavor, uint32_t value);
52: int coalition_policy_get(uint64_t cid, coalition_policy_flavor_t flavor);
53: #endif /* #ifndef KERNEL */
54: 
```

## I: [03-internal.body](/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-05/browser-results/03-internal.body)

### Original lines 83-100
```text
83:  * */
84: #define CONFIG_COALITION_MAX CONFIG_TASK_MAX
85: #define COALITION_CHUNK TASK_CHUNK
86: 
87: #if DEBUG || DEVELOPMENT
88: TUNABLE_WRITEABLE(int, unrestrict_coalition_syscalls, "unrestrict_coalition_syscalls", 0);
89: #else
90: #define unrestrict_coalition_syscalls false
91: #endif
92: 
93: static LCK_GRP_DECLARE(coalitions_lck_grp, "coalition");
94: 
95: /* coalitions_list_lock protects coalition_hash, next_coalition_id. */
96: static LCK_MTX_DECLARE(coalitions_list_lock, &coalitions_lck_grp);
97: static uint64_t coalition_next_id = 1;
98: static struct smr_hash coalition_hash;
99: 
100: coalition_t init_coalition[COALITION_NUM_TYPES];
```

### Original lines 1354-1366
```text
1354: 	new_coal->privileged = privileged ? TRUE : FALSE;
1355: 	new_coal->efficient = efficient ? TRUE : FALSE;
1356: #if DEVELOPMENT || DEBUG
1357: 	new_coal->should_notify = 1;
1358: #endif
1359: 
1360: 	lck_mtx_init(&new_coal->lock, &coalitions_lck_grp, LCK_ATTR_NULL);
1361: 
1362: 	lck_mtx_lock(&coalitions_list_lock);
1363: 	new_coal->id = cid = coalition_next_id++;
1364: 
1365: 	smr_hash_serialized_insert(&coalition_hash, &new_coal->link,
1366: 	    &coal_hash_traits);
```

### Original lines 1466-1479
```text
1466:  * coalition_find_by_id
1467:  * Returns: Coalition object with specified id, referenced.
1468:  */
1469: coalition_t
1470: coalition_find_by_id(uint64_t cid)
1471: {
1472: 	smrh_key_t key = SMRH_SCALAR_KEY(cid);
1473: 
1474: 	if (cid == 0) {
1475: 		return COALITION_NULL;
1476: 	}
1477: 
1478: 	return smr_hash_get(&coalition_hash, key, &coal_hash_traits);
1479: }
```

### Original lines 1601-1620
```text
1601: boolean_t
1602: coalition_is_privileged(coalition_t coal)
1603: {
1604: 	return coal->privileged || unrestrict_coalition_syscalls;
1605: }
1606: 
1607: boolean_t
1608: task_is_in_privileged_coalition(task_t task, int type)
1609: {
1610: 	if (type < 0 || type > COALITION_TYPE_MAX) {
1611: 		return FALSE;
1612: 	}
1613: 	if (unrestrict_coalition_syscalls) {
1614: 		return TRUE;
1615: 	}
1616: 	if (!task->coalition[type]) {
1617: 		return FALSE;
1618: 	}
1619: 	return task->coalition[type]->privileged;
1620: }
```

### Original lines 2174-2290
```text
2174: /*
2175:  * coalition_terminate_internal
2176:  * Condition: Coalition must be referenced and UNLOCKED.
2177:  */
2178: kern_return_t
2179: coalition_request_terminate_internal(coalition_t coal)
2180: {
2181: 	assert(coal->type >= 0 && coal->type <= COALITION_TYPE_MAX);
2182: 
2183: 	if (coal == init_coalition[coal->type]) {
2184: 		return KERN_DEFAULT_SET;
2185: 	}
2186: 
2187: 	coalition_lock(coal);
2188: 
2189: 	if (coal->reaped) {
2190: 		coalition_unlock(coal);
2191: 		return KERN_INVALID_NAME;
2192: 	}
2193: 
2194: 	if (coal->terminated || coal->termrequested) {
2195: 		coalition_unlock(coal);
2196: 		return KERN_TERMINATED;
2197: 	}
2198: 
2199: 	coal->termrequested = TRUE;
2200: 
2201: 	boolean_t do_notify = FALSE;
2202: 	uint64_t note_id = 0;
2203: 	uint32_t note_flags = 0;
2204: 
2205: 	if (coal->active_count == 0) {
2206: 		/*
2207: 		 * We only notify once, when active_count reaches zero.
2208: 		 * We just set termrequested to zero. If the active count
2209: 		 * was already at zero (tasks died before we could request
2210: 		 * a termination notification), we should notify.
2211: 		 */
2212: 		assert(!coal->terminated);
2213: 		coal->terminated = TRUE;
2214: 
2215: 		assert(!coal->notified);
2216: 
2217: 		coal->notified = TRUE;
2218: #if DEVELOPMENT || DEBUG
2219: 		do_notify = coal->should_notify;
2220: #else
2221: 		do_notify = TRUE;
2222: #endif
2223: 		note_id = coal->id;
2224: 		note_flags = 0;
2225: 	}
2226: 
2227: 	coalition_unlock(coal);
2228: 
2229: 	if (do_notify) {
2230: 		coalition_notify_user(note_id, note_flags);
2231: 	}
2232: 
2233: 	return KERN_SUCCESS;
2234: }
2235: 
2236: /*
2237:  * coalition_reap_internal
2238:  * Condition: Coalition must be referenced and UNLOCKED.
2239:  */
2240: kern_return_t
2241: coalition_reap_internal(coalition_t coal)
2242: {
2243: 	assert(coal->type <= COALITION_TYPE_MAX);
2244: 
2245: 	if (coal == init_coalition[coal->type]) {
2246: 		return KERN_DEFAULT_SET;
2247: 	}
2248: 
2249: 	coalition_lock(coal);
2250: 	if (coal->reaped) {
2251: 		coalition_unlock(coal);
2252: 		return KERN_TERMINATED;
2253: 	}
2254: 	if (!coal->terminated) {
2255: 		coalition_unlock(coal);
2256: 		return KERN_FAILURE;
2257: 	}
2258: 	assert(coal->termrequested);
2259: 	if (coal->active_count > 0) {
2260: 		coalition_unlock(coal);
2261: 		return KERN_FAILURE;
2262: 	}
2263: 
2264: 	coal->reaped = TRUE;
2265: 
2266: 	coalition_unlock(coal);
2267: 
2268: 	lck_mtx_lock(&coalitions_list_lock);
2269: 	smr_hash_serialized_remove(&coalition_hash, &coal->link,
2270: 	    &coal_hash_traits);
2271: 	if (smr_hash_serialized_should_shrink(&coalition_hash,
2272: 	    COALITION_HASH_SIZE_MIN, 2, 1)) {
2273: 		/* shrink if more than 2 buckets per 1 element */
2274: 		smr_hash_shrink_and_unlock(&coalition_hash,
2275: 		    &coalitions_list_lock, &coal_hash_traits);
2276: 	} else {
2277: 		lck_mtx_unlock(&coalitions_list_lock);
2278: 	}
2279: 
2280: 	/* Release the list's reference and launchd's reference. */
2281: 	coal_ref_release_live(coal);
2282: 	coalition_release(coal);
2283: 
2284: 	return KERN_SUCCESS;
2285: }
2286: 
2287: #if DEVELOPMENT || DEBUG
2288: int
2289: coalition_should_notify(coalition_t coal)
2290: {
```

## S: [SUMMARY.md](/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/mac-supervision-primitives-05/SUMMARY.md)

### Original lines 1-7
```text
1: # Mac supervision source evidence — acquired, not a runtime gate pass
2: 
3: ## Result
4: 
5: A separate existing Chrome route acquired public XNU source after the ended curl route received no HTTP response. **No coalition/audit/control API or official/model request was run.** Public source is at immutable main commit **`f6217f891ac0bb64f3d375211650a4c1ff8ca1ea`**, not proven to be the host's xnu12377.161.14 implementation.
6: 
7: The real wrapper at this pin is **`bsd/kern/sys_coalition.c`**, not the previously asserted kern_proc.c. Directory metadata and git-blob SHA bind the selected20,870B file; SHA256=`1f252b9329751286f670a8d6824117c2712b4bf20bbf82376fe12c3d39835545`.
```

### Original lines 24-29
```text
24: - Terminate arms termination/empty notification. Its own comment says new posix_spawnattr joins begin failing but existing members may still fork. The internal routine marks termrequested/conditionallyterminated and notifies; **it does not kill the tree**.
25: - Reap requires terminated and empty, returns busy when still active, and consumes a create reference. Ledger uses a separate root check; policy set/get use a separate private entitlement. These must not be conflated with the coalition demux gate.
26: - [User header](browser-results/01-user-header.body) gives typed create/terminate/reap prototypes. The internal lookup explicitly returnsNULL for cid0; ID allocation starts1. These are useful for designing a later non-mutating capability query, **not permission to blindly call an unbound host ABI**. No such call was made. NULL create output is unsuitable because allocation precedes copyout.
27: - DEBUG/DEVELOPMENT-only sysctls and unrestrict controls are not release capabilities; none was used or changed.
28: 
29: ## Memory correction and local docs
```

### Original lines 39-39
```text
39: Mac M3 remains **UNPROVEN**: natural creation/preload applicability, non-escapable complete descendants, independent owner/late-resource/final-publication arbitration and host API authority still need evidence. No finite direct-child, PGID, SessionCreate, notification, source or mock result substitutes for those conditions. Model requests remain0; exact`deepseek-3.2`and native-direct constraints remain unchanged.
```
