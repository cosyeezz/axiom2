/** Only leading assistant protocol blocks, never examples inside prose or code fences. */
export function thinkingDisplay(text, streaming) {
    const blocks = [];
    let rest = text;
    let active = false;
    while (true) {
        const value = rest.trimStart();
        if (streaming && value && "<thinking>".startsWith(value) && value !== "<thinking>") {
            rest = "";
            active = true;
            break;
        }
        if (!value.startsWith("<thinking>"))
            break;
        const end = value.indexOf("</thinking>", 10);
        if (end < 0) {
            let body = value.slice(10);
            if (streaming)
                for (let n = 1; n < "</thinking>".length; n++) {
                    if (body.endsWith("</thinking>".slice(0, n))) {
                        body = body.slice(0, -n);
                        break;
                    }
                }
            blocks.push(body);
            rest = "";
            active = streaming;
            break;
        }
        blocks.push(value.slice(10, end));
        rest = value.slice(end + 11).trimStart();
    }
    return { text: rest, thinking: blocks.join("\n\n").trim(), active };
}
//# sourceMappingURL=thinking-display.js.map