export function register(on, options) {
    on('session.start', async ($, event, next) => {
        await $.command.register({ name: '__PLUGIN_NAME__-review', description: options.label });
        return next(event);
    });
    on('command.run', { command: '__PLUGIN_NAME__-review' }, async ($) =>
        ({ text: `${options.label}: ${await $.session.cwd()}` }));
}
