/**
 * Shared brokered Program Blacklist check for command shims.
 *
 * CLI contract: `node broker-program-policy-check.cjs <program> [runtime] [brokerClientPath]`
 * Exit codes: 0 = allowed/not configured, 126 = forbidden program,
 * 13 = policy check unavailable or otherwise denied.
 */

'use strict';

const fs = require('fs');
const path = require('path');

function checkProgramPolicy(program, runtime = 'brokered-program-policy', options = {}) {
    if (process.platform !== 'darwin') {
        return { code: 0 };
    }
    const command = options.command || process.env.CODEBUDDY_SANDBOX_PROGRAM_POLICY_COMMAND;
    if (!command) {
        return { code: 0 };
    }

    const socketPath = options.socketPath || process.env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS;
    const sessionId = options.sessionId || process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID;
    const brokerClientPath = options.brokerClientPath || path.join(__dirname, 'broker-ipc-client.cjs');
    if (!program || !socketPath || !sessionId || !fs.existsSync(brokerClientPath)) {
        return { code: 13, error: 'Brokered program policy check unavailable' };
    }

    try {
        const { sendBrokerRequestSync } = require(brokerClientPath);
        const response = sendBrokerRequestSync({
            command,
            program,
            sessionId,
            toolCallId: options.toolCallId || process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID,
            brokerTraceId: options.brokerTraceId || process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID,
            runtime,
        });
        if (response && response.ok === true && response.decision === 'allow') {
            return { code: 0, response };
        }
        return {
            code: response && response.reason === 'forbidden_program' ? 126 : 13,
            error: response && response.error
                ? response.error
                : `Brokered program policy denied "${program}"`,
            response,
        };
    } catch (_) {
        return { code: 13, error: 'Brokered program policy check unavailable' };
    }
}

function runCli(argv = process.argv.slice(2)) {
    const [program, runtime, brokerClientPath] = argv;
    const result = checkProgramPolicy(program, runtime || 'brokered-program-policy', { brokerClientPath });
    if (result.error) {
        process.stderr.write(result.error);
    }
    return result.code;
}

module.exports = {
    checkProgramPolicy,
    runCli,
};

if (require.main === module) {
    process.exit(runCli());
}
