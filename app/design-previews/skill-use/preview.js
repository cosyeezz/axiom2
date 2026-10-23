'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const icons = window.SKILL_ICONS;
const recommended = new Set(['S01','S10','S11','S13','S26']);
let chosen = icons[0], library = 'all', locked = false, tab = 'skills', editing = null, originalContent = '', editorTrigger = null;
let toastTimer;
const added = new Set();
const skills = [
  { id:'browser', name:'opencli-browser', description:'驱动浏览器，检查页面布局、表单和交互。', source:'用户技能', path:'~/.pi/agent/skills/opencli-browser/SKILL.md', selected:true, available:true },
  { id:'usage', name:'opencli-usage', description:'发现可用命令，选择合适的浏览器工作方式。', source:'应用技能', path:'应用技能/opencli-usage/SKILL.md', selected:true, available:true },
  { id:'adb', name:'adb-query-expert', description:'编写与检查 ADB 查询，分析查询结果。', source:'用户技能', path:'~/.pi/agent/skills/adb-query-expert/SKILL.md', selected:true, available:true },
  { id:'review', name:'project-review', description:'检查项目约定与代码质量。', source:'项目技能 · 文件不可用', path:'.pi/skills/project-review/SKILL.md', selected:false, available:false }
];
for (const skill of skills) {
  skill.version = 1;
  skill.content = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n# ${skill.name}\n\n${skill.description}\n\n## 工作方法\n\n1. 先确认任务范围与项目约定。\n2. 根据当前页面或数据选择检查步骤。\n3. 记录发现，提供有依据的修改建议。\n4. 完成验证后说明结果与未验证项。\n\n## 输出要求\n\n使用简洁中文，说明发现、证据和下一步。\n`;
  skill.initialContent = skill.content;
}
const pencil = '<svg viewBox="0 0 24 24"><path d="m16 4 4 4M4 20l4-1L20 7a2.83 2.83 0 0 0-4-4L4 15l-1 6Z"/></svg>';
const cross = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M7 17 17 7"/></svg>';
function iconMarkup(icon = chosen) {
  const doc = new DOMParser().parseFromString(icon.svg, 'image/svg+xml');
  const svg = doc.documentElement;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.removeAttribute('width'); svg.removeAttribute('height');
  return svg.outerHTML;
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800);
}
function updateIcons() {
  $$('[data-skill-icon]').forEach(element => element.innerHTML = iconMarkup());
  $('#selected-name').textContent = `${chosen.id} · ${chosen.name}`;
  $('#selected-source').href = chosen.url;
  $$('.icon-option').forEach(element => {
    const selected = element.dataset.id === chosen.id;
    element.dataset.selected = String(selected);
    $('.icon-choose', element).setAttribute('aria-pressed', String(selected));
  });
}
function renderGallery() {
  const query = $('#icon-search').value.toLowerCase().trim();
  const shown = icons.filter(icon => (library === 'all' || library === icon.library || library === 'recommended' && recommended.has(icon.id)) && `${icon.id} ${icon.name} ${icon.label} ${icon.library}`.toLowerCase().includes(query));
  $('#icon-grid').innerHTML = shown.map(icon => `<article class="icon-option" data-id="${icon.id}" data-selected="${icon.id === chosen.id}"><button class="icon-choose" aria-pressed="${icon.id === chosen.id}" aria-label="选择 ${icon.id} ${icon.name}"><span class="icon-topline"><span>${icon.id}</span>${recommended.has(icon.id) ? '<span class="recommend-label">推荐</span>' : ''}</span><span class="icon-visual"><span>${iconMarkup(icon)}</span><span class="small-icon">${iconMarkup(icon)}</span></span><strong>${icon.name}</strong><small>${icon.label}</small></button><div class="icon-source"><span>${icon.library}</span><a href="${icon.url}" target="_blank" rel="noopener" aria-label="${icon.id} ${icon.name} 官网">官网 ↗</a></div></article>`).join('');
  $('#gallery-count').textContent = shown.length ? `显示 ${shown.length} / 50 个图标 · 已选 ${chosen.id} ${chosen.name}` : '没有匹配的图标，请尝试其他名称或编号。';
}
$('#icon-grid').addEventListener('click', event => {
  const button = event.target.closest('.icon-choose'); if (!button) return;
  chosen = icons.find(icon => icon.id === button.closest('.icon-option').dataset.id);
  updateIcons(); $('#gallery-count').textContent = `显示 ${$$('.icon-option').length} / 50 个图标 · 已选 ${chosen.id} ${chosen.name}`;
  toast(`已切换 ${chosen.id}，上方使用按钮、标签与卡片已同步`);
});
$$('[data-library]').forEach(button => button.addEventListener('click', () => {
  library = button.dataset.library;
  $$('[data-library]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  renderGallery();
}));
$('#icon-search').addEventListener('input', renderGallery);
function renderSkills() {
  const query = $('#skill-search').value.toLowerCase().trim();
  $('#selection-state').textContent = locked ? '当前会话 · 选择已锁定' : '当前会话 · 自动保存';
  $('#lock-session').setAttribute('aria-pressed', String(locked));
  if (tab === 'mcp') {
    $('#panel-note').textContent = '勾选后在会话启动时连接；列表不代表连接状态。';
    $('#skill-list').innerHTML = query && !'project-tools'.includes(query) ? '<p class="empty">没有匹配的 MCP。</p>' : `<div class="skill-item"><input type="checkbox" id="mcp-check" checked disabled><label class="skill-title" for="mcp-check">project-tools</label><p class="skill-description">项目工具服务</p><div class="skill-meta"><small>项目配置 · 此预览仅展示</small></div></div>`;
  } else {
    $('#panel-note').textContent = locked ? '选择已锁定，已选技能仍可添加到本次消息。' : '勾选本会话可用技能，点击右侧图标用于本次消息。';
    const shown = skills.filter(skill => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query));
    $('#skill-list').innerHTML = shown.map(skill => {
      const canUse = skill.available && skill.selected;
      const useLabel = !skill.available ? '技能文件不可用' : !skill.selected ? locked ? '本会话未选择此技能，请新建会话调整' : '请先勾选此技能' : added.has(skill.id) ? '已添加到本次消息' : '用于本次消息';
      return `<div class="skill-item" data-skill="${skill.id}"><input id="check-${skill.id}" data-select="${skill.id}" type="checkbox" aria-label="选择 ${skill.name}" ${skill.selected?'checked':''} ${locked || !skill.available?'disabled':''}><label class="skill-title" for="check-${skill.id}">${skill.name}</label><p class="skill-description">${escapeHtml(skill.description)}</p><div class="skill-meta"><small>${skill.source}</small><div class="skill-actions"><span title="${useLabel}"><button type="button" class="icon-button" data-use="${skill.id}" data-added="${added.has(skill.id)}" aria-label="使用 ${skill.name}：${useLabel}" title="${useLabel}" ${!canUse?'disabled':''}><span data-skill-icon>${iconMarkup()}</span></button></span><span title="${skill.available?'编辑 SKILL.md':'技能文件不可用'}"><button type="button" class="icon-button" data-edit="${skill.id}" aria-label="编辑 ${skill.name}" title="编辑 SKILL.md" ${!skill.available?'disabled':''}>${pencil}</button></span></div></div></div>`;
    }).join('') || '<p class="empty">没有匹配的技能。</p>';
  }
  $('#panel-footer').textContent = `已选择 ${skills.filter(skill=>skill.selected).length} 个技能 · ${locked?'可使用已选技能，选择不可更改':'首次启动后锁定选择'}`;
}
$('#skill-list').addEventListener('change', event => {
  const input = event.target.closest('[data-select]'); if (!input) return;
  const skill = skills.find(item => item.id === input.dataset.select); skill.selected = input.checked;
  if (!skill.selected && added.delete(skill.id)) { renderTray(); toast('已从本次消息移除此技能'); }
  renderSkills(); $(`[data-select="${skill.id}"]`)?.focus();
});
$('#skill-list').addEventListener('click', event => {
  const button = event.target.closest('[data-use]'); if (!button || button.disabled) return;
  const skill = skills.find(item => item.id === button.dataset.use);
  if (added.has(skill.id)) { toast('此技能已在输入框上方，无需重复添加'); return; }
  added.add(skill.id); renderTray(); renderSkills(); toast(`已添加 ${skill.name}`);
  $('#prompt').focus({preventScroll:true});
  if (window.innerWidth <= 760) $('.composer-area').scrollIntoView({block:'center', behavior:'smooth'});
});
$('#skill-search').addEventListener('input', renderSkills);
$$('[data-tab]').forEach(button => button.addEventListener('click', () => {
  tab = button.dataset.tab; $('#skill-search').value = '';
  $('#skill-search').placeholder = tab==='skills'?'搜索技能':'搜索 MCP';
  $('#skill-search').setAttribute('aria-label', $('#skill-search').placeholder);
  $$('[data-tab]').forEach(other=>other.setAttribute('aria-pressed',String(other===button))); renderSkills();
}));
$('#lock-session').addEventListener('click', () => { locked = !locked; renderSkills(); toast(locked?'演示：会话已启动，已选技能仍可使用':'演示：恢复首次启动前状态'); });
$('#focus-skills').addEventListener('click',()=>{ $('[data-tab="skills"]').click(); $('#skill-search').focus({preventScroll:true}); $('.capability-panel').scrollIntoView({block:'center',behavior:'smooth'}); });
function renderTray() {
  $('#skill-tray').innerHTML = [...added].map(id => {
    const skill = skills.find(item => item.id === id);
    return `<div class="skill-chip" title="${escapeHtml(skill.path)}"><span data-skill-icon>${iconMarkup()}</span><span>${skill.name}</span><span class="chip-type">Skill</span><button type="button" class="icon-button" data-remove="${id}" aria-label="移除 ${skill.name}" title="从本条消息移除">${cross}</button></div>`;
  }).join('');
}
$('#skill-tray').addEventListener('click',event=>{
  const button = event.target.closest('[data-remove]');if(!button)return;
  added.delete(button.dataset.remove);renderTray();renderSkills();$('#prompt').focus({preventScroll:true});
});
function cardMarkup(skill) {
  return `<details class="skill-card"><summary><span data-skill-icon>${iconMarkup()}</span><span><strong>${escapeHtml(skill.name)}</strong><small>本条消息指定的技能</small></span><span class="card-chevron" aria-hidden="true">›</span></summary><div class="card-details"><p>${escapeHtml(skill.description)}</p><code>${escapeHtml(skill.path)}</code><p>发送时版本 ${skill.version} · ${escapeHtml(skill.source)}</p><button type="button" data-edit="${skill.id}" aria-label="从会话卡片编辑 ${escapeHtml(skill.name)}">${pencil} 编辑当前技能文件</button></div></details>`;
}
$('#sample-card').innerHTML = cardMarkup(skills[0]);
$('#composer-form').addEventListener('submit', event => {
  event.preventDefault();
  const text = $('#prompt').value.trim();
  if(!text){toast('请补充本次任务的描述');$('#prompt').focus();return;}
  const message = document.createElement('div'); message.className='user-message';
  message.innerHTML=`<div class="message-text">${escapeHtml(text)}</div><div class="message-skill-list">${[...added].map(id=>cardMarkup({...skills.find(skill=>skill.id===id)})).join('')}</div><p class="message-time">发送效果演示 · 未连接 Agent</p>`;
  $('#sent-messages').append(message); added.clear(); $('#prompt').value=''; locked=true;renderTray();renderSkills();
  $('#messages').scrollTop=$('#messages').scrollHeight;toast('已演示发送：技能卡片随消息保留');
});
$('#prompt').addEventListener('keydown',event=>{ if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('#composer-form').requestSubmit();} });
function openEditor(skill, trigger) {
  editing=skill;editorTrigger=trigger;originalContent=skill.content;
  $('#editor-skill-name').textContent=skill.name;$('#editor-path').textContent=skill.path;
  $('#skill-content').value=skill.content;$('#editor-status').textContent='已载入示例文件';
  $('#discard-prompt').hidden=true;syncDirty();$('#editor').showModal();$('#skill-content').focus();
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-edit]');if(!button||button.disabled)return;
  const skill=skills.find(item=>item.id===button.dataset.edit);if(skill?.available)openEditor(skill,button);
});
const isDirty=()=>editing && $('#skill-content').value!==originalContent;
function syncDirty(){const dirty=isDirty();$('#dirty-state').textContent=dirty?'未保存':'未修改';$('#save-skill').disabled=!dirty;$('#editor-status').textContent=dirty?'修改尚未保存':'已载入示例文件';}
$('#skill-content').addEventListener('input',syncDirty);
function closeEditor(){ $('#editor').close();editing=null;if(editorTrigger?.isConnected)editorTrigger.focus({preventScroll:true}); }
function requestClose(){ if(isDirty()){ $('#discard-prompt').hidden=false;$('#keep-editing').focus();$('#discard-prompt').scrollIntoView({block:'nearest'}); }else closeEditor(); }
$('#close-editor').addEventListener('click',requestClose);$('#cancel-editor').addEventListener('click',requestClose);
$('#editor').addEventListener('cancel',event=>{event.preventDefault();requestClose();});
$('#keep-editing').addEventListener('click',()=>{$('#discard-prompt').hidden=true;$('#skill-content').focus();});
$('#discard').addEventListener('click',closeEditor);
$('#editor-form').addEventListener('submit',event=>{
  event.preventDefault();if(!editing||!isDirty())return;
  const content=$('#skill-content').value;
  if(!content.trim()){ $('#editor-status').textContent='内容不能为空，请保留技能说明。';$('#skill-content').focus();return; }
  editing.content=content;editing.version+=1;
  closeEditor();toast('已保存到设计预览；本机 Skill 文件未改动');
});
$('#reset-demo').addEventListener('click',()=>{
  added.clear();locked=false;$('#sent-messages').replaceChildren();$('#prompt').value='请检查页面布局与交互，并给出改进建议。';
  skills.forEach(skill=>{skill.selected=skill.available;skill.content=skill.initialContent;skill.version=1;});
  $('[data-tab="skills"]').click();renderTray();toast('演示已重置，当前图标选择保留');
});
renderSkills();renderGallery();updateIcons();
