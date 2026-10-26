export function register(on) {
    on('session.start', async ($, event, next) => {
        await $.command.register({ name: '__PLUGIN_NAME__-checklist', description: 'Show the engineering verification checklist' });
        return next(event);
    });
    on('command.run', { command: '__PLUGIN_NAME__-checklist' }, async ($) => {
        const cwd = await $.session.cwd();
        return { text: `Workspace: ${cwd}\n1. Identify the changed behavior.\n2. Test the relevant contract.\n3. Build the actual artifact.\n4. Verify the user workflow.\n5. Report residual risk.` };
    });
}
