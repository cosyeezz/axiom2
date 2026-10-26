/** A bounded, local display parser. It traces existing strokes and can align
 * small, unambiguous branch indentation errors; it never infers flow semantics,
 * adds missing process lines, or changes the source message. */
const L = 1, R = 2, U = 4, D = 8;
const ports = {};
for (const [chars, value] of [
    ["─━═╌╍", L | R], ["│┃║╎╏", U | D],
    ["┌┏╔╭", R | D], ["┐┓╗╮", L | D], ["└┗╚╰", R | U], ["┘┛╝╯", L | U],
    ["├┣╠", U | D | R], ["┤┫╣", U | D | L], ["┬┳╦", L | R | D], ["┴┻╩", L | R | U], ["┼╋╬", L | R | U | D],
    ["-", L | R], ["|", U | D], ["+", L | R | U | D],
    ["→➜➔>", L | R], ["←<", L | R], ["↑^", U | D], ["↓v", U | D],
])
    for (const char of chars)
        ports[char] = value;
const arrowDirections = { "→": R, "➜": R, "➔": R, ">": R, "←": L, "<": L, "↑": U, "^": U, "↓": D, "v": D };
const steps = [[L, -1, 0, R], [R, 1, 0, L], [U, 0, -1, D], [D, 0, 1, U]];
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const boxLine = /[─━═╌╍│┃║╎╏┌┏╔╭┐┓╗╮└┗╚╰┘┛╝╯├┣╠┤┫╣┬┳╦┴┻╩┼╋╬]/u;
const lineHint = /[─━═╌╍│┃║╎╏┌┏╔╭┐┓╗╮└┗╚╰┘┛╝╯├┣╠┤┫╣┬┳╦┴┻╩┼╋╬]|[-]{2,}|[|+]|[←→↑↓➜➔]/u;
const verticalOnly = /^\s*[│┃║|↑↓^v]\s*$/u;
export const diagramCell = { width: 8.5, height: 22, padding: 12 };
/** Deterministic terminal-style width; box/arrow glyphs always occupy one cell. */
export function diagramTextWidth(text) {
    let width = 0;
    for (const { segment } of segmenter.segment(text))
        width += graphemeWidth(segment);
    return width;
}
/** Anchor natural text to source columns without stretching glyphs. Keep CJK
 * words together: spreading every Han glyph across a two-cell slot looks like
 * unwanted letter-spacing. ASCII and script transitions retain grid anchors. */
export function diagramLabelRuns(label) {
    let x = label.x;
    const runs = [];
    let cjk = false;
    for (const { segment } of segmenter.segment(label.text)) {
        const width = graphemeWidth(segment);
        const nextCjk = /^(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})/u.test(segment);
        if (cjk && nextCjk) {
            const previous = runs.at(-1);
            previous.text += segment;
            previous.width += width;
            previous.center += width / 2;
        }
        else
            runs.push({ text: segment, center: x + width / 2, width });
        cjk = nextCjk;
        x += width;
    }
    return runs;
}
function graphemeWidth(text) {
    if (ports[text])
        return 1;
    const point = text.codePointAt(0);
    if (/^\p{Mark}/u.test(text))
        return 0;
    return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(text) ||
        point >= 0x1100 && (point <= 0x115f || point === 0x2329 || point === 0x232a ||
            point >= 0x2e80 && point <= 0xa4cf || point >= 0xac00 && point <= 0xd7a3 ||
            point >= 0xf900 && point <= 0xfaff || point >= 0xfe10 && point <= 0xfe6f ||
            point >= 0xff01 && point <= 0xff60 || point >= 0xffe0 && point <= 0xffe6 || point >= 0x20000) ? 2 : 1;
}
/** Display-only hint for keeping an unsupported text diagram unwrapped. This
 * does not authorize SVG conversion or consume arbitrary Markdown paragraphs. */
export function hasAsciiDiagramLayout(source) {
    if (source.length > 24_000)
        return false;
    return source.split("\n").filter(line => /[\u2500-\u257f]|[-+]{3,}|^\s*\|.*\|\s*$/u.test(line)).length >= 2;
}
/** Only correct indentation where the fixed anchors determine a single answer:
 * ┐/├/┘ with aligned outer corners, or an adjacent ├/└ branch. A movable row
 * contains exactly one leading branch, its horizontal stroke and its label.
 * Work from immutable source coordinates; never drag a second structure along. */
function alignedBranchSource(source) {
    if (source.length > 24_000 || /[\t┌╭╮╰╯]/u.test(source) || /^\s*\+[-+]+\+/mu.test(source) || !/[─├][→➜➔]/u.test(source))
        return;
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 120)
        return;
    const anchors = lines.map(line => {
        const result = [];
        let x = 0;
        for (const { segment } of segmenter.segment(line)) {
            if (/[│┐┘├┤┬┴┼└]/u.test(segment))
                result.push({ char: segment, x });
            x += graphemeWidth(segment);
        }
        return result;
    });
    const shifts = new Map();
    for (let y = 0; y < lines.length; y++) {
        const movable = /^( *)([├└][─→➜➔]+) +(.+)$/u.exec(lines[y]);
        if (!movable || anchors[y].length !== 1 || /[\u2500-\u257f←→↑↓➜➔|]|--|\+[-+]/u.test(movable[3]))
            continue;
        const x = movable[1].length, char = movable[2][0];
        const targets = [];
        if (char === "├" && y > 0 && y + 1 < lines.length) {
            for (const top of anchors[y - 1].filter(a => a.char === "┐" && Math.abs(a.x - x) <= 2)) {
                if (anchors[y + 1].some(a => a.char === "┘" && a.x === top.x))
                    targets.push(top.x);
            }
        }
        if (char === "└" && y > 0) {
            targets.push(...anchors[y - 1].filter(a => a.char === "├" && Math.abs(a.x - x) <= 2).map(a => a.x));
        }
        if (targets.length > 1)
            return; // No nearest-neighbour guessing.
        if (targets.length === 1 && targets[0] !== x)
            shifts.set(y, targets[0] - x);
    }
    if (!shifts.size)
        return;
    // Moving a row that already has a real vertical connection would sever it.
    // Also reject interacting proposals rather than letting scan order decide.
    for (const [y, shift] of shifts) {
        const anchor = anchors[y][0];
        for (const dy of [-1, 1]) {
            if (shifts.has(y + dy))
                return;
            const facing = dy === -1 ? D : U, own = dy === -1 ? U : D;
            if ((ports[anchor.char] & own) && anchors[y + dy]?.some(a => a.x === anchor.x && (ports[a.char] & facing)))
                return;
        }
        const indent = /^ */u.exec(lines[y])[0].length;
        if (indent + shift < 0)
            return;
    }
    for (const [y, shift] of shifts)
        lines[y] = shift > 0 ? " ".repeat(shift) + lines[y] : lines[y].slice(-shift);
    return { source: lines.join("\n"), rows: shifts.size, maxShift: Math.max(...[...shifts.values()].map(Math.abs)) };
}
export function parseAsciiDiagram(source) {
    const original = parseDiagramGrid(source);
    const aligned = alignedBranchSource(source);
    if (aligned) {
        const diagram = parseDiagramGrid(aligned.source);
        if (diagram)
            return { ...diagram, alignment: { rows: aligned.rows, maxShift: aligned.maxShift } };
    }
    return original;
}
function parseDiagramGrid(source) {
    // Cheap rejection precedes segmentation. Avoid control/bidi characters which
    // cannot be faithfully represented by this left-to-right grid.
    if (source.length > 24_000 || !lineHint.test(source) || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(source))
        return;
    const lines = source.replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && !lines.at(-1).trim())
        lines.pop();
    if (lines.length < 2 || lines.length > 120)
        return;
    // Unsupported line styles carry meaning. Do not flatten double/heavy/dashed
    // strokes into a single thin line, or mix untraced diagonal branches into SVG.
    if (Array.from(source).some(char => /[\u2500-\u257f]/u.test(char) && !"─│┌┐└┘├┤┬┴┼╭╮╰╯".includes(char)) ||
        /[↗↘↙↖⤡⤢]/u.test(source) || /^\s*[\\/\\\\]+(?:[ \t]+[\\/\\\\]+)*\s*$/mu.test(source))
        return;
    // A table is not a flow diagram. Its uninterrupted rules contain at least
    // three vertical junctions, unlike two separate side-by-side node boxes.
    const tableRules = lines.filter(line => /^[+─┌┐┬┴┼└┘-]+$/u.test(line.trim()) &&
        Array.from(line).filter(char => (ports[char] & (U | D)) !== 0).length >= 3);
    if (tableRules.length >= 2 && !/[←→↑↓➜➔<>]/u.test(source))
        return;
    const cells = [], grid = new Map();
    let columns = 0;
    for (const [y, line] of lines.entries()) {
        // C++, a--b, and signed numbers inside labels are text, not strokes.
        // An explicit <-- / --> remains a connector even without surrounding spaces.
        const literal = new Set();
        for (const match of line.matchAll(/\++|-+/g)) {
            const before = line.slice(0, match.index), after = line.slice(match.index + match[0].length);
            const word = /[\p{L}\p{N}]$/u.test(before) || /^[\p{L}\p{N}]/u.test(after);
            const directedDash = match[0][0] === "-" && (before.endsWith("<") || after.startsWith(">"));
            if (word && !directedDash)
                for (let i = match.index; i < match.index + match[0].length; i++)
                    literal.add(i);
        }
        let x = 0;
        for (const { segment, index } of segmenter.segment(line)) {
            if (segment === "\t") {
                x += 4 - x % 4;
                continue;
            }
            const width = graphemeWidth(segment);
            const before = line.slice(0, index), after = line.slice(index + segment.length);
            // save/save must not create a vertical v-arrow; x^2 is not an arrow
            // either. Horizontal ASCII heads next to words need an explicit tail.
            const word = /[\p{L}\p{N}]$/u.test(before) || /^[\p{L}\p{N}]/u.test(after);
            const textArrow = /[v^<>]/u.test(segment) && word &&
                !(segment === ">" && /[-─]$/u.test(before) || segment === "<" && /^[-─]/u.test(after));
            const cell = { text: segment, x, y, width, ports: literal.has(index) || textArrow ? 0 : ports[segment] ?? 0, strong: boxLine.test(segment), drawn: false, arrow: arrowDirections[segment] };
            cells.push(cell);
            grid.set(`${x}:${y}`, cell);
            x += width;
            if (x > 240 || cells.length > 16_000)
                return;
        }
        columns = Math.max(columns, x);
    }
    // Compute immutable candidate adjacency first. Mutating ports while walking
    // the grid made classification depend on row order and unconfirmed arrows.
    const adjacent = new Map();
    for (const cell of cells) {
        if (!cell.ports)
            continue;
        let connected = 0;
        for (const [port, dx, dy, opposite] of steps) {
            const other = grid.get(`${cell.x + dx}:${cell.y + dy}`);
            if ((cell.ports & port) && other && (other.ports & opposite))
                connected |= port;
        }
        adjacent.set(cell, connected);
    }
    // Flood the exterior of the candidate drawing. A disconnected ASCII formula
    // inside a box is body text, not a second diagram merely because +/| line up.
    const exterior = new Set(), stride = columns + 2;
    const key = (x, y) => (y + 1) * stride + x + 1;
    const queue = [[-1, -1]];
    exterior.add(key(-1, -1));
    for (let i = 0; i < queue.length; i++) {
        const [x, y] = queue[i];
        for (const [, dx, dy] of steps) {
            const nx = x + dx, ny = y + dy, id = key(nx, ny);
            if (nx < -1 || nx > columns || ny < -1 || ny > lines.length || exterior.has(id) || grid.get(`${nx}:${ny}`)?.ports)
                continue;
            exterior.add(id);
            queue.push([nx, ny]);
        }
    }
    const visited = new Set();
    for (const root of adjacent.keys()) {
        if (visited.has(root))
            continue;
        const component = [root];
        visited.add(root);
        const corners = new Set();
        let strong = false, arrowTail = false, outside = false;
        for (let i = 0; i < component.length; i++) {
            const cell = component[i], connected = adjacent.get(cell);
            strong ||= cell.strong;
            if ([R | D, L | D, R | U, L | U].includes(connected))
                corners.add(connected);
            const tail = cell.arrow === R ? L : cell.arrow === L ? R : cell.arrow === U ? D : U;
            for (const [port, dx, dy] of steps) {
                outside ||= exterior.has(key(cell.x + dx, cell.y + dy));
                if (!(connected & port))
                    continue;
                const other = grid.get(`${cell.x + dx}:${cell.y + dy}`);
                if (cell.arrow && port === tail && !other.arrow)
                    arrowTail = true;
                if (!visited.has(other)) {
                    visited.add(other);
                    component.push(other);
                }
            }
        }
        // Four corner masks alone also occur in two rows of "++ i / ++ j".
        // A nested ASCII box needs real horizontal/vertical edges and an interior.
        // The bounding rectangle test is deliberately conservative for ambiguous
        // punctuation components; explicit Unicode and external flows are separate.
        let asciiBox = false;
        if (!strong && corners.size === 4) {
            const xs = component.map(cell => cell.x), ys = component.map(cell => cell.y);
            const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
            asciiBox = right - left >= 2 && bottom - top >= 2 &&
                [[left, top], [right, top], [left, bottom], [right, bottom]].every(([x, y]) => grid.get(`${x}:${y}`)?.text === "+");
            for (let x = left + 1; asciiBox && x < right; x++)
                asciiBox = grid.get(`${x}:${top}`)?.text === "-" && grid.get(`${x}:${bottom}`)?.text === "-";
            for (let y = top + 1; asciiBox && y < bottom; y++)
                asciiBox = grid.get(`${left}:${y}`)?.text === "|" && grid.get(`${right}:${y}`)?.text === "|";
        }
        // Other disconnected ASCII components need a real arrow tail outside a box.
        const confirmed = strong || asciiBox || arrowTail && outside;
        if (!confirmed)
            continue;
        for (const cell of component) {
            const connected = adjacent.get(cell);
            const tail = cell.arrow === R ? L : cell.arrow === L ? R : cell.arrow === U ? D : U;
            cell.drawn = cell.arrow ? !!(connected & tail) : cell.strong || !!connected;
        }
    }
    // Candidates that were not ultimately drawn cannot support an arrow. An
    // arrowhead is not a tail stroke either (v/v/│ must not invent a tail above).
    for (const cell of cells) {
        if (!cell.drawn || !cell.arrow)
            continue;
        const dx = cell.arrow === R ? -1 : cell.arrow === L ? 1 : 0;
        const dy = cell.arrow === D ? -1 : cell.arrow === U ? 1 : 0;
        const tail = grid.get(`${cell.x + dx}:${cell.y + dy}`);
        if (!tail?.drawn || tail.arrow)
            cell.drawn = false;
    }
    let connections = 0, verticalConnections = 0, arrows = 0, verticals = 0;
    const drawingRows = new Set(), boxCorners = new Set();
    for (const cell of cells) {
        if (!cell.drawn)
            continue;
        // Only confirmed strokes can support another stroke or arrow.
        let connected = 0;
        for (const [port, dx, dy] of steps) {
            if ((adjacent.get(cell) & port) && grid.get(`${cell.x + dx}:${cell.y + dy}`)?.drawn)
                connected |= port;
        }
        if (!cell.strong && !cell.arrow)
            cell.ports = connected;
        if (connected & R)
            connections++;
        if (connected & D) {
            connections++;
            verticalConnections++;
        }
        if (cell.arrow)
            arrows++;
        if (cell.ports & (U | D))
            verticals++;
        if ([R | D, L | D, R | U, L | U].includes(cell.ports))
            boxCorners.add(cell.ports);
        drawingRows.add(cell.y);
    }
    // Four-corner boxes with broken/misaligned corners are not safe to beautify.
    // Keep incomplete branch diagrams literal too if no vertical stroke connects.
    if (!verticalConnections || boxCorners.size === 4 && cells.some(cell => cell.strong &&
        [R | D, L | D, R | U, L | U].includes(cell.ports) && adjacent.get(cell) !== cell.ports))
        return;
    // Accept connected flow diagrams or actual boxes, not directory trees,
    // Markdown tables, lone separators, one-line prose, or disconnected glyphs.
    const labelRows = cells.filter(cell => !cell.drawn && /[\p{L}\p{N}]/u.test(cell.text)).map(cell => cell.y);
    // A short | + v connection between two label rows is already unambiguous.
    const shortVertical = connections >= 1 && verticals >= 2 &&
        cells.some(cell => cell.drawn && (cell.arrow === U || cell.arrow === D)) &&
        labelRows.some(y => y < Math.min(...drawingRows)) && labelRows.some(y => y > Math.max(...drawingRows));
    if (connections < 3 && !shortVertical || drawingRows.size < 2 || !(arrows && verticals || boxCorners.size === 4 && verticals >= 4))
        return;
    if (!labelRows.length)
        return;
    const strokes = [], labels = [];
    let label;
    for (const cell of cells) {
        if (cell.drawn) {
            strokes.push({ x: cell.x, y: cell.y, ports: cell.ports, arrow: cell.arrow, rounded: /[╭╮╰╯]/u.test(cell.text) || undefined });
            label = undefined;
        }
        else if (/^\s+$/u.test(cell.text)) {
            label = undefined;
        }
        else if (label && label.y === cell.y && label.x + label.width === cell.x) {
            label.text += cell.text;
            label.width += cell.width;
        }
        else {
            label = { x: cell.x, y: cell.y, width: cell.width, text: cell.text };
            labels.push(label);
        }
    }
    return { columns, rows: lines.length, strokes, labels };
}
/** Find diagram runs in a plain Markdown paragraph, without consuming prose. */
export function asciiDiagramBlocks(source) {
    if (source.length > 24_000)
        return [];
    const lines = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
    const candidates = lines.map((line, i) => !!line.trim() && (lineHint.test(line) || verticalOnly.test(line) ||
        !!lines[i - 1]?.trim() && verticalOnly.test(lines[i - 1]) || !!lines[i + 1]?.trim() && verticalOnly.test(lines[i + 1])));
    const result = [];
    let offset = 0;
    for (let i = 0; i < lines.length;) {
        if (!candidates[i]) {
            offset += lines[i++].length;
            continue;
        }
        const start = offset;
        let text = "";
        while (i < lines.length && candidates[i]) {
            text += lines[i];
            offset += lines[i++].length;
        }
        const diagram = parseAsciiDiagram(text);
        if (diagram)
            result.push({ start, end: offset, text, diagram });
    }
    return result;
}
/** SVG geometry in grid coordinates. No interpolation of untrusted markup. */
export function diagramStrokePath(stroke) {
    const { width: w, height: h, padding: p } = diagramCell;
    const x = p + (stroke.x + .5) * w, y = p + (stroke.y + .5) * h;
    const ends = [[L, x - w / 2, y], [R, x + w / 2, y], [U, x, y - h / 2], [D, x, y + h / 2]];
    const parts = ends.filter(([port]) => (stroke.ports & port) && port !== stroke.arrow);
    let path = stroke.rounded && parts.length === 2
        ? `M${parts[0][1]},${parts[0][2]}Q${x},${y} ${parts[1][1]},${parts[1][2]}`
        : parts.map(([, ex, ey]) => `M${x},${y}L${ex},${ey}`).join("");
    if (stroke.arrow) {
        const dx = stroke.arrow === R ? 1 : stroke.arrow === L ? -1 : 0;
        const dy = stroke.arrow === D ? 1 : stroke.arrow === U ? -1 : 0;
        const tx = x + dx * w / 2, ty = y + dy * h / 2;
        path += `M${x},${y}L${tx},${ty}M${tx - dx * 5 - dy * 4},${ty - dy * 5 + dx * 4}L${tx},${ty}L${tx - dx * 5 + dy * 4},${ty - dy * 5 - dx * 4}`;
    }
    return path;
}
//# sourceMappingURL=ascii-diagram.js.map