({ 15275(eA, el, ec) {
        "use strict";
        ec.r(el), ec.d(el, { BlobStoreImpl: () => ew, BlobStore: () => eg.BlobStore, ImageBlobService: () => eg.ImageBlobService, ToolResultBlobServiceImpl: () => e_.ToolResultBlobServiceImpl, ToolResultBlobService: () => e_.ToolResultBlobService, ImageBlobServiceImpl: () => eB });
        var eu, ed, ep, eg = ec(7990), eh = ec(80699), ef = ec(54601), em = ec(79896), eE = ec(91943), eC = ec(16928), ey = ec(93039), __decorate = function (eA, el, ec, eu) { var ed, ep = arguments.length, eg = ep < 3 ? el : null === eu ? eu = Object.getOwnPropertyDescriptor(el, ec) : eu; if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            eg = Reflect.decorate(eA, el, ec, eu);
        else
            for (var eh = eA.length - 1; eh >= 0; eh--)
                (ed = eA[eh]) && (eg = (ep < 3 ? ed(eg) : ep > 3 ? ed(el, ec, eg) : ed(el, ec)) || eg); return ep > 3 && eg && Object.defineProperty(el, ec, eg), eg; }, __metadata = function (eA, el) { if ("object" == typeof Reflect && "function" == typeof Reflect.metadata)
            return Reflect.metadata(eA, el); };
        let ew = class {
            init() { this.logger.setContext("BlobStore"); }
            async store(eA, el, ec, eu) { let ed = Buffer.from(eA, "base64"), ep = (0, ef.createHash)("sha256").update(ed).digest("hex"), eg = this.getBlobPath(ep, el); return (0, em.existsSync)(eg) || (await (0, eE.mkdir)((0, eC.dirname)(eg), { recursive: !0 }), await (0, eE.writeFile)(eg, ed), this.logger.debug(`Blob stored: ${ep.substring(0, 12)}... (${ed.length} bytes)`)), { type: "image_blob_ref", blob_id: ep, mime: el, size: ed.length, source: ec, blob_path: eg, original_filename: eu }; }
            async read(eA, el) { let ec = this.getBlobPath(eA, el); try {
                return (await (0, eE.readFile)(ec)).toString("base64");
            }
            catch {
                this.logger.warn(`Blob not found: ${eA.substring(0, 12)}...`);
                return;
            } }
            async exists(eA, el) { try {
                return await (0, eE.access)(this.getBlobPath(eA, el)), !0;
            }
            catch {
                return !1;
            } }
            getBlobPath(eA, el) { return ey.PathUtils.getBlobPath(eA, el); }
        };
        __decorate([(0, eh.Autowired)(eh.Logger), __metadata("design:type", "function" == typeof (eu = void 0 !== eh.Logger && eh.Logger) ? eu : Object)], ew.prototype, "logger", void 0), __decorate([(0, eh.PostConstruct)(), __metadata("design:type", Function), __metadata("design:paramtypes", []), __metadata("design:returntype", void 0)], ew.prototype, "init", null), ew = __decorate([(0, eh.Component)(eg.BlobStore)], ew);
        var image_blob_service_decorate = function (eA, el, ec, eu) { var ed, ep = arguments.length, eg = ep < 3 ? el : null === eu ? eu = Object.getOwnPropertyDescriptor(el, ec) : eu; if ("object" == typeof Reflect && "function" == typeof Reflect.decorate)
            eg = Reflect.decorate(eA, el, ec, eu);
        else
            for (var eh = eA.length - 1; eh >= 0; eh--)
                (ed = eA[eh]) && (eg = (ep < 3 ? ed(eg) : ep > 3 ? ed(el, ec, eg) : ed(el, ec)) || eg); return ep > 3 && eg && Object.defineProperty(el, ec, eg), eg; }, image_blob_service_metadata = function (eA, el) { if ("object" == typeof Reflect && "function" == typeof Reflect.metadata)
            return Reflect.metadata(eA, el); };
        let eB = ed = class {
            constructor() { this.deliveredImages = new Map, this.deliveredBlobIds = new Set; }
            init() { this.logger.setContext("ImageBlobService"); }
            async storeFromDataUri(eA, el, ec) { let eu = eA.match(/^data:([^;]+);base64,(.+)$/s); if (!eu)
                throw Error("Invalid data URI format"); let [, ed, ep] = eu; return this.blobStore.store(ep, ed, el, ec); }
            async storeFromFile(eA) { let el = (await (0, eE.readFile)(eA)).toString("base64"), ec = await ey.ImageUtils.getImageMimeTypeAsync(eA, eE.readFile); return this.blobStore.store(el, ec, eA); }
            async rehydrate(eA) { let el = await this.blobStore.read(eA.blob_id, eA.mime); if (el)
                return `data:${eA.mime};base64,${el}`; }
            createPlaceholder(eA) { let el = ey.FileUtils.formatFileSize(eA.size), ec = eA.original_filename || eA.source || "unknown"; return `[Image from ${ec} (${eA.mime}, ${el}) - stored at: ${eA.blob_path}]`; }
            isImageBlobRef(eA) { return null !== eA && "object" == typeof eA && "image_blob_ref" === eA.type && "string" == typeof eA.blob_id; }
            trackImageDelivered(eA, el) { if (el) {
                let ec = this.deliveredImages.get(el);
                return ec === eA ? "unchanged" : void 0 !== ec ? (this.deliveredImages.set(el, eA), this.deliveredBlobIds.add(eA), "new") : (this.deliveredImages.set(el, eA), this.deliveredBlobIds.has(eA)) ? "duplicate" : (this.deliveredBlobIds.add(eA), "new");
            } return this.deliveredBlobIds.has(eA) ? "duplicate" : (this.deliveredBlobIds.add(eA), "new"); }
            resetImageTracking() { this.deliveredImages.clear(), this.deliveredBlobIds.clear(); }
            async processHistoryForApi(eA, el) { let ec = 0, eu = 0; for (let ed = eA.length - 1; ed >= 0; ed--) {
                let ep = eA[ed];
                if ("message" === ep.type && "user" === ep.role && ++ec >= el) {
                    eu = ed;
                    break;
                }
            } let ed = !1; for (let el of eA)
                if (this.itemHasBlobRef(el)) {
                    ed = !0;
                    break;
                } if (!ed)
                return eA; let ep = this.buildRehydrateSet(eA, eu), eg = []; for (let el = 0; el < eA.length; el++) {
                let ec = eA[el];
                if (!this.itemHasBlobRef(ec)) {
                    eg.push(ec);
                    continue;
                }
                if (el < eu) {
                    eg.push(this.dehydrateItem(ec));
                    continue;
                }
                ep.has(el) ? eg.push(await this.rehydrateItem(ec)) : eg.push(this.dehydrateItem(ec));
            } return eg; }
            buildRehydrateSet(eA, el) { let ec = []; for (let eu = el; eu < eA.length; eu++) {
                let el = this.collectBlobRefs(eA[eu]);
                el.length > 0 && ec.push({ index: eu, refs: el });
            } let eu = new Map; for (let { index: eA, refs: el } of ec)
                for (let ec of el)
                    eu.set(ec.blob_id, eA); let ep = ec.filter(({ index: eA, refs: el }) => el.some(el => eu.get(el.blob_id) === eA)), eg = new Map, eh = []; for (let { index: eA, refs: el } of ep) {
                let ec = new Set(el.map(eA => eA.source).filter(Boolean));
                if (0 === ec.size)
                    eh.push(eA);
                else
                    for (let el of ec)
                        eg.has(el) || eg.set(el, []), eg.get(el).push(eA);
            } let ef = new Set; for (let eA of eh)
                ef.add(eA); for (let [, eA] of eg)
                for (let el of eA.slice(-ed.MAX_VERSIONS_PER_SOURCE))
                    ef.add(el); return ef; }
            collectBlobRefs(eA) { let el = [], ec = eA; if ("message" === ec.type && "user" === ec.role && Array.isArray(ec.content))
                for (let eA of ec.content)
                    if ("input_image" === eA.type && this.isImageBlobRef(eA.image)) {
                        let ec = eA.image;
                        el.push({ blob_id: ec.blob_id, source: ec.source });
                    }
                    else
                        this.isImageBlobRef(eA) && el.push({ blob_id: eA.blob_id, source: eA.source }); if (ec.providerData?.toolResult?.content) {
                let eA = ec.providerData.toolResult.content;
                if (Array.isArray(eA))
                    for (let ec of eA) {
                        if (this.isImageBlobRef(ec)) {
                            let eA = ec;
                            el.push({ blob_id: eA.blob_id, source: eA.source });
                        }
                        if (ec?.type === "image_url" && ec.image_url?.url) {
                            let eA = this.extractBlobRefFromUrl(ec.image_url.url);
                            eA && el.push({ blob_id: eA.blob_id, source: eA.source });
                        }
                    }
                this.extractBlobRefsFromString("string" == typeof eA ? eA : "", el);
            } let eu = "string" == typeof ec.output ? ec.output : "string" == typeof ec.output?.text ? ec.output.text : ""; return eu && this.extractBlobRefsFromString(eu, el), el; }
            extractBlobRefsFromString(eA, el) { let ec; if (!eA.includes("image_blob_ref"))
                return; let eu = /\{[^{}]*"type"\s*:\s*"image_blob_ref"[^{}]*\}/g; for (; null !== (ec = eu.exec(eA));)
                try {
                    let eA = JSON.parse(ec[0]);
                    eA.blob_id && el.push({ blob_id: eA.blob_id, source: eA.source });
                }
                catch {
                    let eA = ec[0].match(/"blob_id"\s*:\s*"([a-f0-9]{64})"/);
                    eA && el.push({ blob_id: eA[1] });
                } }
            itemHasBlobRef(eA) { let el = eA; if ("message" === el.type && "user" === el.role && Array.isArray(el.content)) {
                for (let eA of el.content)
                    if ("input_image" === eA.type && this.isImageBlobRef(eA.image) || this.isImageBlobRef(eA))
                        return !0;
            } if (("function_call_result" === el.type || "function_call_output" === el.type) && ("string" == typeof el.output ? el.output : "string" == typeof el.output?.text ? el.output.text : "").includes("image_blob_ref"))
                return !0; if (el.providerData?.toolResult?.content) {
                let eA = el.providerData.toolResult.content;
                if (("string" == typeof eA ? eA : JSON.stringify(eA)).includes("image_blob_ref"))
                    return !0;
            } return !1; }
            async rehydrateItem(eA) { let el = eA; if ("message" === el.type && "user" === el.role && Array.isArray(el.content)) {
                let eA = [...el.content], ec = !1;
                for (let el = 0; el < eA.length; el++) {
                    let eu = eA[el], ed = "input_image" === eu.type && this.isImageBlobRef(eu.image) ? eu.image : this.isImageBlobRef(eu) ? eu : void 0;
                    if (ed) {
                        let eu = await this.rehydrate(ed);
                        eu ? eA[el] = { type: "input_image", image: eu, ...ed.original_filename ? { original_filename: ed.original_filename } : {} } : eA[el] = { type: "input_text", text: this.createPlaceholder(ed) }, ec = !0;
                    }
                }
                if (ec)
                    return { ...el, content: eA };
            } return "function_call_result" === el.type || "function_call_output" === el.type ? this.rehydrateFunctionCallResult(el) : eA; }
            dehydrateItem(eA) { let el = eA; if ("message" === el.type && "user" === el.role && Array.isArray(el.content)) {
                let eA = [...el.content], ec = !1;
                for (let el = 0; el < eA.length; el++) {
                    let eu = eA[el], ed = "input_image" === eu.type && this.isImageBlobRef(eu.image) ? eu.image : this.isImageBlobRef(eu) ? eu : void 0;
                    ed && (eA[el] = { type: "input_text", text: this.createPlaceholder(ed) }, ec = !0);
                }
                if (ec)
                    return { ...el, content: eA };
            } return "function_call_result" === el.type || "function_call_output" === el.type ? this.dehydrateFunctionCallResult(el) : eA; }
            async rehydrateFunctionCallResult(eA) { let el = !1, ec = { ...eA }, eu = "string" == typeof ec.output ? ec.output : "string" == typeof ec.output?.text ? ec.output.text : ""; if (eu.includes("image_blob_ref"))
                try {
                    let eA = JSON.parse(eu), ed = await this.processContentArray(eA, "rehydrate");
                    ed !== eA && ("string" == typeof ec.output ? ec.output = JSON.stringify(ed) : ec.output = { ...ec.output, text: JSON.stringify(ed) }, el = !0);
                }
                catch { } if (ec.providerData?.toolResult?.content) {
                let eA = ec.providerData.toolResult.content;
                if (Array.isArray(eA)) {
                    let eu = await this.processContentArray(eA, "rehydrate");
                    eu !== eA && (ec.providerData = { ...ec.providerData, toolResult: { ...ec.providerData.toolResult, content: eu } }, el = !0);
                }
                else if ("string" == typeof eA && eA.includes("image_blob_ref"))
                    try {
                        let eu = JSON.parse(eA), ed = await this.processContentArray(eu, "rehydrate");
                        ed !== eu && (ec.providerData = { ...ec.providerData, toolResult: { ...ec.providerData.toolResult, content: JSON.stringify(ed) } }, el = !0);
                    }
                    catch { }
            } return el ? ec : eA; }
            dehydrateFunctionCallResult(eA) { let el = !1, ec = { ...eA }, eu = "string" == typeof ec.output ? ec.output : "string" == typeof ec.output?.text ? ec.output.text : ""; if (eu.includes("image_blob_ref"))
                try {
                    let eA = JSON.parse(eu), ed = this.processContentArraySync(eA, "dehydrate");
                    ed !== eA && ("string" == typeof ec.output ? ec.output = JSON.stringify(ed) : ec.output = { ...ec.output, text: JSON.stringify(ed) }, el = !0);
                }
                catch { } if (ec.providerData?.toolResult?.content) {
                let eA = ec.providerData.toolResult.content;
                if (Array.isArray(eA)) {
                    let eu = this.processContentArraySync(eA, "dehydrate");
                    eu !== eA && (ec.providerData = { ...ec.providerData, toolResult: { ...ec.providerData.toolResult, content: eu } }, el = !0);
                }
                else if ("string" == typeof eA && eA.includes("image_blob_ref"))
                    try {
                        let eu = JSON.parse(eA), ed = this.processContentArraySync(eu, "dehydrate");
                        ed !== eu && (ec.providerData = { ...ec.providerData, toolResult: { ...ec.providerData.toolResult, content: JSON.stringify(ed) } }, el = !0);
                    }
                    catch { }
            } return el ? ec : eA; }
            async processContentArray(eA, el) { if (Array.isArray(eA)) {
                let el = !1, ec = [...eA];
                for (let eA = 0; eA < ec.length; eA++) {
                    let eu = ec[eA];
                    if (eu && "object" == typeof eu && "image_url" === eu.type && eu.image_url) {
                        let ed = this.extractBlobRefFromUrl(eu.image_url.url);
                        if (ed) {
                            let ep = await this.rehydrate(ed);
                            ep ? ec[eA] = { ...eu, image_url: { ...eu.image_url, url: ep } } : ec[eA] = { type: "text", text: this.createPlaceholder(ed) }, el = !0;
                        }
                    }
                    else if (eu && "object" == typeof eu && "image_blob_ref" === eu.type) {
                        let ed = await this.rehydrate(eu);
                        ed ? ec[eA] = { type: "image_url", image_url: { url: ed } } : ec[eA] = { type: "text", text: this.createPlaceholder(eu) }, el = !0;
                    }
                }
                return el ? ec : eA;
            } return eA; }
            processContentArraySync(eA, el) { if (Array.isArray(eA)) {
                let el = !1, ec = [...eA];
                for (let eA = 0; eA < ec.length; eA++) {
                    let eu = ec[eA];
                    if (eu && "object" == typeof eu && "image_url" === eu.type && eu.image_url) {
                        let ed = this.extractBlobRefFromUrl(eu.image_url.url);
                        ed && (ec[eA] = { type: "text", text: this.createPlaceholder(ed) }, el = !0);
                    }
                    else
                        eu && "object" == typeof eu && "image_blob_ref" === eu.type && (ec[eA] = { type: "text", text: this.createPlaceholder(eu) }, el = !0);
                }
                return el ? ec : eA;
            } return eA; }
            extractBlobRefFromUrl(eA) { if (this.isImageBlobRef(eA))
                return eA; if ("string" == typeof eA && eA.includes("image_blob_ref"))
                try {
                    let el = JSON.parse(eA);
                    if (this.isImageBlobRef(el))
                        return el;
                }
                catch { } }
        };
        eB.MAX_VERSIONS_PER_SOURCE = 3, image_blob_service_decorate([(0, eh.Autowired)(eg.BlobStore), image_blob_service_metadata("design:type", Object)], eB.prototype, "blobStore", void 0), image_blob_service_decorate([(0, eh.Autowired)(eh.Logger), image_blob_service_metadata("design:type", "function" == typeof (ep = void 0 !== eh.Logger && eh.Logger) ? ep : Object)], eB.prototype, "logger", void 0), image_blob_service_decorate([(0, eh.PostConstruct)(), image_blob_service_metadata("design:type", Function), image_blob_service_metadata("design:paramtypes", []), image_blob_service_metadata("design:returntype", void 0)], eB.prototype, "init", null), eB = ed = image_blob_service_decorate([(0, eh.Component)(eg.ImageBlobService)], eB);
        var e_ = ec(56236);
    } });
