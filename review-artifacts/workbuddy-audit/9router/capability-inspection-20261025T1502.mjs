import {getCapabilitiesForModel} from './source-20261025T150242849/open-sse/providers/capabilities.js';
import cn from './source-20261025T150242849/open-sse/providers/registry/codebuddy-cn.js';
import intl from './source-20261025T150242849/open-sse/providers/registry/codebuddy-intl.js';
console.log(JSON.stringify([cn,intl].map(p=>({provider:p.id,models:p.models.map(m=>({model:m.id,...getCapabilitiesForModel(p.id,m.id)}))})),null,2));