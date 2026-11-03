import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
const root = resolve('app/src/client');
function css(file) {return readFileSync(file,'utf8').replace(/@import\s+"([^"]+)";/g, (_,name)=>css(resolve(dirname(file),name)));}
const styles = ['tokens','message-edit','workbench','chat','page-overrides'].map(name=>css(resolve(root,`styles/${name}.css`))).join('\n');
const glyph = name => `<svg class="ui-glyph" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${name}"/></svg>`;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>${styles}</style><style>
body{padding:20px}#host{height:500px;overflow:auto;width:740px}.log-row{margin:100px 40px 0;padding:20px}.spacer{height:900px}
body[data-baseline=true] .message-actions>button>svg{display:none!important}
</style></head><body>${readFileSync(resolve(root,'icons.svg'),'utf8')}
<button id="outside">Outside focus</button><div id="host"><div class="log-row"><div class="reply-body">部署或重启。</div><div class="message-actions reply-actions"><button class="action-icon copy-reply" aria-label="Copy">${glyph('copy')}</button><button class="action-icon fork-action" aria-label="Fork">${glyph('git-branch')}</button></div></div><div class="spacer"></div></div>
<script>
window.testCases=[];
for(const zoom of [.8,1,1.25])for(const disabled of [false,true])for(const state of ['idle','reveal','hide','scroll-reveal','scroll-hide'])for(const baseline of [false,true])testCases.push({zoom,disabled,state,baseline,name:'z'+zoom+'-'+(disabled?'disabled':'enabled')+'-'+state+(baseline?'-baseline':'')});
const actions=document.querySelector('.reply-actions'),copy=actions.querySelector('.copy-reply'),fork=actions.querySelector('.fork-action'),outside=document.querySelector('#outside'),host=document.querySelector('#host');
window.runCase=i=>{const c=testCases[i];document.body.style.zoom=String(c.zoom);document.body.dataset.baseline=String(c.baseline);fork.disabled=c.disabled;actions.removeAttribute('data-feedback');
// A background NSWindow cannot acquire DOM focus without taking focus from the user.
// Use the production feedback reveal selector to test the same paint declarations.
if(c.state==='reveal'||c.state==='scroll-reveal')actions.dataset.feedback='copied';host.scrollTop=c.state.startsWith('scroll-')?75:0;return c;};
window.inspectCase=i=>{const c=testCases[i],visible=!c.baseline&&['reveal','scroll-reveal'].includes(c.state);const buttons=[...actions.querySelectorAll('button')].map(b=>({disabled:b.disabled,opacity:getComputedStyle(b).opacity,display:getComputedStyle(b.querySelector('svg')).display,glyphRects:b.querySelector('svg').getClientRects().length,box:b.getBoundingClientRect().toJSON()}));
if(buttons.some(b=>b.display!==(visible?'block':'none')||b.glyphRects!==(visible?1:0)))throw new Error('glyph state mismatch '+JSON.stringify({c,buttons}));
return {...c,visible,buttons,dpr:devicePixelRatio,userAgent:navigator.userAgent,hover:matchMedia('(hover:hover)').matches};};
</script></body></html>`;
writeFileSync(resolve('test-results/fork-no-paint-native/index.html'),html);
