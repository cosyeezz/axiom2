/**
 * Historical Node safe-delete entry.
 *
 * Keep this wrapper so older NODE_OPTIONS values that require
 * genie-safe-delete.cjs continue to load the composed Node language shim.
 */

'use strict';

module.exports = require('./node-language-shim.cjs');
