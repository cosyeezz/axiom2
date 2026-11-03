// Bounded Mach-O decoding/decompilation only. Invoke headless with -noanalysis.
// @category KiroEvidence
import ghidra.app.script.GhidraScript;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.address.*;
import ghidra.program.model.block.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.SourceType;
import com.google.gson.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class FocusedRequest extends GhidraScript {
    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format("%02x", b & 0xff));
        return out.toString();
    }
    @Override public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 4) throw new IllegalArgumentException("output, start, endInclusive, name required");
        Path output = Paths.get(args[0]);
        if (Files.exists(output)) throw new IllegalStateException("CreateNew output exists");
        Address start = toAddr(args[1]);
        Address end = toAddr(args[2]);
        long length = end.subtract(start) + 1;
        if (length <= 0 || length > 8192) throw new IllegalArgumentException("range budget 1..8192 bytes");
        AddressSet range = new AddressSet(start, end);
        JsonObject root = new JsonObject();
        root.addProperty("scope", "explicit range only; no automatic or callee analysis");
        root.addProperty("program", currentProgram.getName());
        root.addProperty("language", currentProgram.getLanguageID().toString());
        root.addProperty("compilerSpec", currentProgram.getCompilerSpec().getCompilerSpecID().toString());
        root.addProperty("imageBase", currentProgram.getImageBase().toString());
        root.addProperty("entry", start.toString());
        root.addProperty("endInclusive", end.toString());
        root.addProperty("rangeBytes", length);
        root.addProperty("functionsBefore", currentProgram.getFunctionManager().getFunctionCount());
        byte[] raw = new byte[(int)length];
        int read = currentProgram.getMemory().getBytes(start, raw);
        if (read != length) throw new IllegalStateException("short memory read");
        root.addProperty("bytesHex", hex(raw));
        DisassembleCommand command = new DisassembleCommand(start, range, true);
        command.enableCodeAnalysis(false);
        boolean decoded = command.applyTo(currentProgram, monitor);
        root.addProperty("disassemblyCommandSucceeded", decoded);
        root.addProperty("disassemblyStatus", command.getStatusMsg());
        Function f = currentProgram.getFunctionManager().getFunctionAt(start);
        if (f == null) f = currentProgram.getFunctionManager().createFunction(args[3], start, range, SourceType.USER_DEFINED);
        else f.setBody(range);
        if (f == null) throw new IllegalStateException("function creation failed");
        root.addProperty("functionsAfter", currentProgram.getFunctionManager().getFunctionCount());
        JsonArray instructions = new JsonArray();
        BitSet coverage = new BitSet((int)length);
        InstructionIterator it = currentProgram.getListing().getInstructions(range, true);
        while (it.hasNext()) {
            Instruction ins = it.next();
            JsonObject row = new JsonObject();
            row.addProperty("address", ins.getAddress().toString());
            row.addProperty("bytes", hex(ins.getBytes()));
            row.addProperty("asm", ins.toString());
            row.addProperty("flowType", ins.getFlowType().toString());
            JsonArray flows = new JsonArray();
            for (Address a : ins.getFlows()) flows.add(a.toString());
            row.add("flows", flows);
            if (ins.getFallThrough() != null) row.addProperty("fallThrough", ins.getFallThrough().toString());
            instructions.add(row);
            int offset = (int)ins.getAddress().subtract(start);
            coverage.set(offset, Math.min((int)length, offset + ins.getLength()));
        }
        root.add("instructions", instructions);
        JsonArray gaps = new JsonArray();
        for (int i = coverage.nextClearBit(0); i < length;) {
            int stop = coverage.nextSetBit(i);
            if (stop < 0 || stop > length) stop = (int)length;
            JsonObject gap = new JsonObject();
            gap.addProperty("start", start.add(i).toString());
            gap.addProperty("endInclusive", start.add(stop - 1).toString());
            gap.addProperty("bytes", stop-i);
            gaps.add(gap);
            i = coverage.nextClearBit(stop);
        }
        root.addProperty("decodedBytes", coverage.cardinality());
        root.add("undecodedGaps", gaps);
        BasicBlockModel blocks = new BasicBlockModel(currentProgram);
        CodeBlockIterator bit = blocks.getCodeBlocksContaining(range, monitor);
        JsonArray cfg = new JsonArray();
        while (bit.hasNext()) {
            CodeBlock b = bit.next();
            JsonObject row = new JsonObject();
            row.addProperty("start", b.getFirstStartAddress().toString());
            row.addProperty("min", b.getMinAddress().toString());
            row.addProperty("max", b.getMaxAddress().toString());
            JsonArray edges = new JsonArray();
            CodeBlockReferenceIterator eit = b.getDestinations(monitor);
            while (eit.hasNext()) {
                CodeBlockReference e = eit.next();
                JsonObject edge = new JsonObject();
                edge.addProperty("source", e.getReferent().toString());
                edge.addProperty("destination", e.getReference().toString());
                edge.addProperty("flowType", e.getFlowType().toString());
                edges.add(edge);
            }
            row.add("edges", edges);
            cfg.add(row);
        }
        root.add("cfg", cfg);
        DecompInterface di = new DecompInterface();
        try {
            di.setOptions(new DecompileOptions());
            di.toggleCCode(true);
            di.toggleSyntaxTree(false);
            if (!di.openProgram(currentProgram)) throw new IllegalStateException("decompiler open failed: " + di.getLastMessage());
            DecompileResults result = di.decompileFunction(f, 20, monitor);
            root.addProperty("decompileCompleted", result.decompileCompleted());
            root.addProperty("decompileError", result.getErrorMessage());
            if (result.getDecompiledFunction() != null) root.addProperty("c", result.getDecompiledFunction().getC());
        } finally { di.dispose(); }
        String json = new GsonBuilder().setPrettyPrinting().create().toJson(root) + "\n";
        Files.write(output, json.getBytes(StandardCharsets.UTF_8), StandardOpenOption.CREATE_NEW);
        println("FOCUSED_RESULT=" + output + " decoded=" + coverage.cardinality() + "/" + length);
    }
}
