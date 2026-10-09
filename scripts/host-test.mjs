import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { decodeText } from '../src/core.js';

const project = resolve(new URL('..', import.meta.url).pathname);
const cli = process.env.DCA_CLI ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
const llmModule = process.env.DCA_LLM_MODULE ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
const root = await mkdtemp(join(tmpdir(), 'dca-host-')), home = join(root, 'home'), workspace = join(root, 'workspace');
const profile = join(home, 'profiles/web'), artifacts = join(project, 'artifacts');
await mkdir(join(profile, 'node_modules/@deepseekharness-plugin'), { recursive: true });
await mkdir(workspace); await mkdir(artifacts, { recursive: true });
await symlink(project, join(profile, 'node_modules/@deepseekharness-plugin/dsh-codex-annotations'));
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dca-host-test', private: true,
  dependencies: { '@deepseekharness-plugin/dsh-codex-annotations': `link:${project}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
await writeFile(join(profile, 'cordis.yml'), '[]');
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } }]));
const patch = join(root, 'test.patch.yml'), capturePath = join(artifacts, 'model-request.json');
await writeFile(patch, JSON.stringify([
  ...['llm-deepseek', 'llm-pi-ai', 'session-title-llm'].map(id => ({ id, disabled: true })),
  { id: 'session-persistence-jsonl', config: { compression: 'none', root: join(home, 'sessions') } },
  { id: 'agent-default-model', config: { provider: 'dca-fixture', model: 'fixture' } },
  { id: 'compaction-basic', config: { retainTokens: 0 } },
  { insert: [{ id: 'dca-fixture', name: pathToFileURL(join(project, 'tests/mock-model.mjs')).href }] }
]));
const referenceQuote = '失的是助手回答正文，用量数字还在。这和刚才启用插件时出现的显示问题一致；我先检查你现在的窗';
const modelNotes = text => [...text.matchAll(/\[用户批注\]\n[^\n]*\n([^\n]*)\n\[\/用户批注\]/g)].flatMap(match => JSON.parse(match[1]));
const linkedQuote = '链接前文 dsh-annotation 和 dsh-sidenote，包含 Annotations ×N 与加粗文本。';
const fixtureText = '这个插件会把选中的原文和你的评论随下一条消息一起发给模型。你可以连续添加多条批注，并随时返回原文查看。\n\n```js\nconst greeting = "你好🙂";\nconsole.log(greeting);\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 空评论 | 支持 |\n| 多条批注 | 支持 |\n\n'
  + '链接前文 [dsh-annotation](https://github.com/omdsh-dev/dsh-annotation) 和 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote)，包含 `Annotations ×N` 与**加粗文本**。\n\n'
  + Array.from({ length: 40 }, (_, i) => `长回答的第 ${i + 1} 段。跳转应定位具体选区，保留输入框，并避开顶部栏和批注浮层。`).join('\n\n')
  + '\n\n截图里消失的是助手回答正文，用量数字还在。这和刚才启用插件时出现的显示问题一致；我先检查你现在的窗口，再定位插件为何会把正文隐藏。';
const sourceDir = join(home, 'sessions', '-' + workspace.replaceAll('/', '-') + '--');
for (const [id, title, text] of [['dca-preview', '批注交互预览', fixtureText], ['dca-other', '另一会话', '这是另一个会话，批注应相互独立。']]) {
  const sessionDir = join(sourceDir, 'session-' + id); await mkdir(sessionDir, { recursive: true });
  const now = Date.now(), block = { type: 'text', text }, reasoning = { type: 'reasoning', text: '这是折叠的思考过程。' };
  const events = [
    { type: 'permission/preset', data: { preset: 'workspace-write' } },
    { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
    { type: 'approval/policy', data: { policy: 'ask' } },
    { type: 'turn/start', data: { turn: 1 } }, { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: { role: 'user', id: id + '-user', content: [{ type: 'text', text: title }], source: { kind: 'user' } } },
    { type: 'session/title', data: { title, messageSeqs: [5], source: { kind: 'fallback' } } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', id: id + '-assistant', content: [reasoning, block], source: { kind: 'model', provider: 'dca-fixture', model: 'fixture' } }, stream: [
      { type: 'chunk', time: 7, chunk: { type: 'block-start', index: 0, blockType: 'reasoning' } },
      { type: 'text-chunks', time0: 7, index: 0, dt: [], texts: [reasoning.text] },
      { type: 'chunk', time: 7, chunk: { type: 'block-end', index: 0, block: reasoning } },
      { type: 'chunk', time: 7, chunk: { type: 'block-start', index: 1, blockType: 'text' } },
      { type: 'text-chunks', time0: 7, index: 1, dt: [], texts: [text] },
      { type: 'chunk', time: 7, chunk: { type: 'block-end', index: 1, block } },
      { type: 'chunk', time: 7, chunk: { type: 'finish', reason: { kind: 'stop' } } }
    ] } },
    { type: 'step/end', data: { turn: 1, step: 1 } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'session/end-seed', data: {} }
  ];
  await writeFile(join(sessionDir, 'session.v4.jsonl'), [JSON.stringify({ type: 'session', version: 4, id: 'session-' + id, createdAt: now, cwd: workspace, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }), ...events.map((e, seq) => JSON.stringify({ ...e, seq, time: now + seq + 1 }))].join('\n') + '\n');
}
let child, browser, page, log = '';
const errors = [], consoleErrors = [], uiMeasurements = {};
const screenshots = async name => { await page.screenshot({ path: join(artifacts, `${name}.png`), scale: 'css' }); };
// Compare physical pixels at the same 2x scale as the supplied Codex captures.
// Full workflow screenshots stay at 1x; only the isolated controls use 2x.
const measureControl = async (name, selector) => {
  const element = page.locator(selector).first();
  await element.evaluate(el => new Promise(resolve => {
    let previous = ''; let stable = 0;
    const frame = () => { const r = el.getBoundingClientRect(), next = JSON.stringify([r.x, r.y, r.width, r.height]); stable = next === previous ? stable + 1 : 0; previous = next; if (stable >= 2) resolve(); else requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
  }));
  uiMeasurements[name] = await element.evaluate(el => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: style.borderRadius,
      fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight,
      cornerShape: style.cornerShape, background: style.backgroundColor, border: style.border, shadow: style.boxShadow };
  });
  const box = await element.boundingBox();
  await page.screenshot({ path: join(artifacts, `pixel-${name}@2x.png`), scale: 'device', clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: box.width + 24, height: box.height + 24 } });
};
try {
  child = spawn(cli, ['--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', DCA_LLM_MODULE: llmModule, DCA_CAPTURE_PATH: capturePath }
  });
  child.stdout.on('data', c => { log += c; }); child.stderr.on('data', c => { log += c; });
  const deadline = Date.now() + 20000;
  while (!/dsh web: (http:\/\/\S+)/.test(log)) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('Host boot failed: ' + log); await new Promise(r => setTimeout(r, 100)); }
  await writeFile(join(artifacts, 'host.log'), log);
  browser = await chromium.launch({ channel: process.env.DCA_BROWSER ?? 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.text()); }); page.setDefaultTimeout(12000);
  await page.goto(log.match(/dsh web: (http:\/\/\S+)/)[1], { waitUntil: 'domcontentloaded' });
  await page.locator('[contenteditable=true]').waitFor();
  if (await page.getByRole('button', { name: '继续', exact: true }).count()) await page.getByRole('button', { name: '继续', exact: true }).click();
  // Fresh restored sessions can initially use the untitled label until opened.
  const rows = page.getByRole('treeitem'); await rows.first().waitFor();
  let target = rows.filter({ hasText: '批注交互预览' });
  if (!await target.count()) target = rows.filter({ hasText: '未命名' }).last();
  await target.click();
  await page.locator('[data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]').waitFor();
  if (!await page.getByText('这个插件会把', { exact: false }).count()) {
    await rows.filter({ hasText: '未命名' }).first().click();
  }
  // Enable against an already rendered conversation: cold boot misses the
  // host's retained per-entry injection cache and cannot catch that regression.
  assert.match(await page.locator('[data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]').first().innerText(), /这个插件/);
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 @deepseekharness-plugin/dsh-codex-annotations', exact: true }).click();
  await rows.filter({ hasText: '批注交互预览' }).click();
  const body = page.locator('[data-dca-content]').first(); await body.waitFor();
  assert.match(await body.innerText(), /这个插件/);
  const select = async text => {
    await body.scrollIntoViewIfNeeded();
    await body.evaluate((el, text) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let full = '';
      for (let node; (node = walker.nextNode());) { nodes.push({ node, start: full.length, end: full.length + node.length }); full += node.data; }
      const at = full.indexOf(text); if (at < 0) throw new Error('找不到测试选区: ' + text);
      const first = nodes.find(n => n.end > at), last = [...nodes].reverse().find(n => n.start < at + text.length);
      const range = document.createRange(); range.setStart(first.node, at - first.start); range.setEnd(last.node, at + text.length - last.start);
      first.node.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, text);
    await page.getByRole('button', { name: '添加到对话', exact: true }).waitFor();
  };
  const assertSentLayout = async (index, name, annotationOnly = false) => {
    const row = page.locator('.dca-user-message').nth(index);
    await row.scrollIntoViewIfNeeded();
    const layout = await row.evaluate(el => {
      const header = el.querySelector('.dca-sent-pills'), native = header.nextElementSibling;
      const actions = native.querySelector('[data-clock="start"]');
      const rect = element => { const r = element.getBoundingClientRect(); return { top:r.top, bottom:r.bottom, right:r.right }; };
      const lastButton = [...el.querySelectorAll('button')].at(-1);
      const flow = el.closest('[data-chat-flow-key]');
      let previous = flow.previousElementSibling;
      while (previous && (!previous.getBoundingClientRect().height || previous.hidden)) previous = previous.previousElementSibling;
      return { header:rect(header), native:rect(native), actions:rect(actions), paddingTop:getComputedStyle(el).paddingTop,
        precedingGap:previous ? header.getBoundingClientRect().top - previous.getBoundingClientRect().bottom : null,
        nativeActionsLast:actions.contains(lastButton), radius:getComputedStyle(header.querySelector('.dca-batch-chip')).borderRadius };
    });
    assert.ok(layout.header.bottom <= layout.native.top, 'Sent annotations must precede the native message bubble');
    assert.ok(layout.actions.top >= layout.native.top, 'The native action bar remains below the message');
    assert.ok(layout.nativeActionsLast, 'No plugin control may follow the native message actions');
    assert.equal(layout.radius, '999px');
    assert.equal(layout.paddingTop, annotationOnly ? '16px' : '0px', 'Only an annotation-only message adds top breathing room');
    await writeFile(join(artifacts, `${name}.json`), JSON.stringify(layout, null, 2));
    await row.screenshot({ path:join(artifacts, `${name}.png`), scale:'css' });
    const box = await row.boundingBox(), top = Math.max(0, box.y - 70);
    await page.screenshot({ path:join(artifacts, `${name}-context.png`), scale:'css',
      clip:{ x:box.x, y:top, width:box.width, height:box.y + box.height + 12 - top } });
  };
  const assertQuoteVisible = async (number, editing = false) => {
    const marker = page.getByRole('button', { name: `批注 ${number}，待发送`, exact: true });
    const id = await marker.getAttribute('data-dca-marker');
    await page.waitForFunction(({ id, editing }) => {
      const marks = [...document.querySelectorAll('[data-dca-highlight]')].filter(el => el.dataset.dcaHighlight === id);
      const first = marks.map(el => el.getBoundingClientRect()).sort((a, b) => a.top - b.top)[0];
      if (!first) return false;
      const scroll = marks[0].closest('[data-conversation-scroll]'), pane = scroll.getBoundingClientRect();
      const composer = scroll.querySelector('[data-composer-seat]').getBoundingClientRect();
      const badge = document.querySelector(`[data-dca-marker="${id}"]`).getBoundingClientRect();
      const editor = document.querySelector('.dca-editor')?.getBoundingClientRect();
      const bottom = Math.max(...marks.map(el => el.getBoundingClientRect().bottom));
      const hit = document.elementFromPoint(badge.left + badge.width / 2, badge.top + badge.height / 2);
      return badge.top >= pane.top + 12 && bottom <= composer.top - 12 && hit?.dataset.dcaMarker === id
        && (!editing || (editor && editor.top >= pane.top + 12 && editor.bottom <= first.top - 6));
    }, { id, editing });
    if (!editing) {
      assert.equal(await page.locator('.dca-float').count(), 0, 'Quote navigation must close overlays instead of opening another details card');
    }
  };
  await select(linkedQuote); await page.getByRole('button', { name:'添加到对话', exact:true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name:'批注 1，待发送', exact:true }).waitFor();
  const linkEvidence = await body.evaluate((el, quote) => {
    const paragraph = [...el.querySelectorAll('p')].find(p=>p.textContent===quote);
    const links = [...paragraph.querySelectorAll('a')];
    const full = document.createRange(); full.selectNodeContents(paragraph);
    const rects = [...full.getClientRects()].map(r=>({left:r.left,top:r.top,width:r.width,height:r.height}));
    const point = node => {const r=document.createRange();r.selectNodeContents(node);const b=r.getClientRects()[0];return {x:b.left+b.width/2,y:b.top+1};};
    return {rects, points:{plain:point(paragraph.firstChild),link1:point(links[0].lastChild),link2:point(links[1].lastChild)},
      hrefs:links.map(a=>a.getAttribute('href')),hitLinks:links.map(a=>{const b=a.getBoundingClientRect();return document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)?.closest('a')===a;})};
  },linkedQuote);
  const linkShot = await page.screenshot({scale:'device',path:join(artifacts,`linked-highlight-${process.env.DCA_LINK_CAPTURE ?? 'after'}@2x.png`)});
  linkEvidence.colors = await page.evaluate(async ({png,points}) => {
    const picture=new Image();picture.src='data:image/png;base64,'+png;await picture.decode();
    const canvas=document.createElement('canvas');canvas.width=picture.width;canvas.height=picture.height;
    const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(picture,0,0);
    return Object.fromEntries(Object.entries(points).map(([key,p])=>[key,[...c.getImageData(Math.floor(p.x*2),Math.floor(p.y*2),1,1).data]]));
  },{png:linkShot.toString('base64'),points:linkEvidence.points});
  await writeFile(join(artifacts,`linked-highlight-${process.env.DCA_LINK_CAPTURE ?? 'after'}.json`),JSON.stringify(linkEvidence,null,2));
  if(process.env.DCA_LINK_CAPTURE!=='before') {
    assert.deepEqual(linkEvidence.colors.link1,linkEvidence.colors.plain,'First link must not receive a second blue layer');
    assert.deepEqual(linkEvidence.colors.link2,linkEvidence.colors.plain,'Second link must not receive a second blue layer');
  }
  assert.deepEqual(linkEvidence.hitLinks,[true,true],'Highlight must preserve native hyperlink click targets');
  await page.getByRole('button', { name:'批注 1，待发送', exact:true }).click();
  await page.getByRole('button', { name:'删除批注 1', exact:true }).click();
  await page.locator('[data-dca-marker]').waitFor({state:'hidden'});
  await select(referenceQuote); await screenshots('01-selection-menu');
  await measureControl('menu', '.dca-menu');
  assert.equal(uiMeasurements.menu.height, 30);
  assert.ok(uiMeasurements.menu.width <= 155);
  await page.getByRole('button', { name: '更多详情', exact: true }).click();
  assert.equal(await page.locator('.dca-details pre').innerText(), referenceQuote);
  await page.getByRole('button', { name: '关闭详情' }).click();
  await select(referenceQuote); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await measureControl('editor-compact', '.dca-editor-compact');
  assert.equal(uiMeasurements['editor-compact'].width, 296); assert.equal(uiMeasurements['editor-compact'].height, 46);
  await screenshots('10-compact-editor');
  await page.getByRole('textbox', { name: '批注 1 的可选评论', exact: true }).click();
  const comment = page.getByRole('textbox', { name: '批注 1 的可选评论' });
  await measureControl('editor', '.dca-editor');
  assert.equal(uiMeasurements.editor.width, 296); assert.equal(uiMeasurements.editor.height, 86);
  await measureControl('marker', '.dca-marker');
  assert.equal(uiMeasurements.marker.width, 27); assert.equal(uiMeasurements.marker.height, 27);
  const highlight = await page.locator('.dca-highlight').first().boundingBox();
  assert.ok(Math.abs(uiMeasurements.marker.y + 29 - highlight.y) <= 1, 'Marker must sit above the quote rather than cover its text');
  const dock = await page.locator('.dca-dock').boundingBox();
  const composer = await page.locator('[contenteditable=true]').first().evaluate(el => {
    const rect = el.closest('[data-composer-card]').getBoundingClientRect(); return { x: rect.x, width: rect.width };
  });
  uiMeasurements.dock = { ...dock, composer };
  assert.ok(await page.locator('.dca-dock').evaluate(el => !!el.closest('[data-composer-card]')), 'Annotation chip must be inside the native composer');
  await measureControl('batch-chip', '.dca-dock .dca-batch-chip');
  assert.equal(uiMeasurements['batch-chip'].height, 32);
  assert.ok(Math.abs(uiMeasurements['batch-chip'].width - 89) < 1);
  assert.ok(await page.locator('.dca-batch-open>span').first().evaluate(el => el.scrollWidth <= el.clientWidth), 'Annotation count must remain fully readable');
  await comment.fill('未保存的修改'); await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '批注 1，待发送', exact: true }).click();
  assert.equal(await comment.inputValue(), '', 'Cancel must preserve the saved comment');
  await comment.fill('测试1'); await screenshots('02-inline-comment'); await comment.press('Enter');
  const countChip = page.locator('.dca-dock .dca-batch-chip');
  const chipAppearance = () => countChip.evaluate(el => {
    const label = el.querySelector('.dca-batch-open>span'), close = el.querySelector('.dca-chip-remove');
    const text = getComputedStyle(label), button = getComputedStyle(close);
    return { color: text.color, fontWeight: text.fontWeight, mask: text.maskImage,
      closeOpacity: button.opacity, closeCorner: button.cornerShape, closeRadius: button.borderRadius };
  });
  await page.mouse.move(1200, 100);
  const idleAppearance = await chipAppearance();
  assert.equal(idleAppearance.mask, 'none', 'Idle chip must show the complete annotation count');
  assert.equal(idleAppearance.closeOpacity, '0', 'Idle chip must hide the close control');
  await measureControl('chip-idle', '.dca-dock .dca-batch-chip');
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  const hoverAppearance = await chipAppearance();
  assert.equal(hoverAppearance.color, idleAppearance.color, 'Hovering the chip must keep the label neutral instead of blue');
  assert.equal(hoverAppearance.closeOpacity, '1');
  assert.ok(['round', 'superellipse(1)'].includes(hoverAppearance.closeCorner), 'Host corner-shape must not turn the close circle into a squircle');
  await measureControl('chip-hover', '.dca-dock .dca-batch-chip');
  uiMeasurements['chip-appearance'] = { idle: idleAppearance, hover: hoverAppearance };
  await measureControl('annotations', '.dca-annotations');
  assert.equal(uiMeasurements.annotations.width, 384);
  assert.equal(uiMeasurements.annotations.height, 143);
  assert.equal(uiMeasurements.annotations.x, uiMeasurements['batch-chip'].x, 'Popup must align with the chip border');
  assert.equal(await page.locator('.dca-quote').innerText(), referenceQuote);
  assert.equal(await page.locator('.dca-comment').innerText(), '测试1');
  await screenshots('11-composer-annotations');
  await page.locator('.dca-annotations').getByRole('button', { name: '编辑批注 1', exact: true }).click();
  assert.equal(await comment.inputValue(), '测试1', 'Popup pencil must edit the saved comment');
  await assertQuoteVisible(1, true);
  assert.equal(await page.getByText('原文已变化，无法准确定位；批注原文仍保留。', { exact: true }).count(), 0, 'Folded reasoning must not handle a response quote');
  assert.equal(await page.locator('[data-chat-group-part="reasoning"] .dca-source').count(), 0);
  assert.ok(await page.locator('[data-chat-group-part="response"] .dca-source').count() > 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.locator('.dca-quote').click();
  await assertQuoteVisible(1);
  await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTo({ top: 0, behavior: 'instant' }));
  await page.getByRole('button', { name: '1 条注释', exact: true }).click();
  await assertQuoteVisible(1);
  await screenshots('12-long-answer-jump');
  const previewInput = page.locator('[contenteditable=true]').first();
  const draftLines = Array.from({ length: 8 }, (_, i) => `跳转期间保留第 ${i + 1} 行草稿`);
  await previewInput.click(); await previewInput.press('End');
  for (const [index, line] of draftLines.entries()) { if (index) await previewInput.press('Shift+Enter'); await page.keyboard.insertText(line); }
  const tallDraft = await previewInput.innerText();
  assert.ok(draftLines.every(line => tallDraft.includes(line)), 'Native composer must contain all multiline draft input');
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.locator('.dca-annotations').getByRole('button', { name: '编辑批注 1', exact: true }).click();
  await comment.fill(Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行编辑内容`).join('\n'));
  await assertQuoteVisible(1, true);
  assert.equal(await previewInput.innerText(), tallDraft, 'Navigation must preserve the native composer draft');
  await screenshots('13-tall-composer-edit');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await previewInput.click(); await previewInput.press('ControlOrMeta+a'); await previewInput.press('Backspace');
  await page.waitForFunction(() => document.querySelector('[contenteditable=true]').innerText.trim() === '');
  await page.setViewportSize({ width: 480, height: 860 });
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.locator('.dca-annotations').getByRole('button', { name: '编辑批注 1', exact: true }).click();
  await assertQuoteVisible(1, true);
  await screenshots('14-narrow-jump-edit');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.locator('.dca-quote').click();
  await assertQuoteVisible(1);
  await page.getByRole('button', { name: '1 条注释', exact: true }).click();
  await assertQuoteVisible(1);
  await page.setViewportSize({ width: 1280, height: 900 });
  await select('连续添加多条批注'); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 2 的可选评论', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 2 的可选评论' }).press('Enter');
  await page.locator('[data-dca-marker]').nth(1).waitFor(); await screenshots('03-numbered-anchors');
  assert.deepEqual(await page.locator('[data-dca-marker]').allTextContents(), ['1', '2']);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-dca-marker]').nth(1).waitFor();
  assert.deepEqual(await page.locator('[data-dca-marker]').allTextContents(), ['1', '2']);
  await screenshots('04-restored-draft');
  const input = page.locator('[contenteditable=true]').first();
  // Old versions could retain pending notes with their native reference
  // detached. Simulate that state through the native editor, then restore it.
  await input.click(); await input.press('ControlOrMeta+a'); await input.press('Backspace');
  await page.waitForFunction(() => !document.querySelector('[contenteditable=true] [data-composer-chip="dsh-codex-annotations"]'));
  assert.equal(await page.locator('[data-dca-marker]').count(), 2);
  await page.reload({ waitUntil:'domcontentloaded' }); await input.waitFor();
  await input.locator('[data-composer-chip="dsh-codex-annotations"]').waitFor({ state:'attached' });
  assert.deepEqual(await page.locator('[data-dca-marker]').allTextContents(), ['1','2']);
  assert.equal(await page.getByRole('button', { name:'附加批注', exact:true }).count(), 0);
  await input.click(); await input.press('End');
  await page.keyboard.insertText('请按批注修改。'); await input.pressSequentially(' Keep English.');
  assert.match(await input.innerText(), /请按批注修改。 Keep English\./);
  await input.press('Enter'); await page.getByText('本地测试已收到批注与用户要求。', { exact: true }).waitFor();
  await screenshots('05-sent-annotations');
  const messages = JSON.parse(await readFile(capturePath, 'utf8')), last = messages.filter(m => m.role === 'user' && m.content?.some(b => b.type === 'text' && modelNotes(b.text).length)).at(-1);
  const text = last.content.filter(b => b.type === 'text').map(b => b.text).join(''), projectedNotes = modelNotes(text);
  assert.match(text, /请按批注修改。 Keep English\./);
  assert.deepEqual(projectedNotes, [{ number: 1, quote: referenceQuote, comment: '测试1' }, { number: 2, quote: '连续添加多条批注' }]);
  for (const field of ['DSH_ANNOTATIONS_V1', 'nodeKey', 'prefix', 'suffix', 'revision', 'sessionId']) assert.ok(!text.includes(field), field + ' must stay out of model annotations');
  const durableEvents = (await readFile(join(sourceDir, 'session-dca-preview/session.v4.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  const durable = durableEvents.filter(e => e.type === 'user/message').map(e => e.data).find(m => m.id === last.id);
  const rawPayload = durable.content.flatMap(b => b.type === 'text' ? decodeText(b.text).payloads : [])[0];
  assert.equal(rawPayload.annotations.length, 2);
  assert.equal(rawPayload.annotations[0].quote, referenceQuote);
  assert.equal(typeof rawPayload.annotations[0].nodeKey, 'string');
  assert.equal(typeof rawPayload.annotations[0].prefix, 'string');
  assert.equal(typeof rawPayload.annotations[0].id, 'string');
  assert.equal(typeof rawPayload.annotations[0].revision, 'number');
  assert.equal(await page.locator('[data-dca-dock]').count(), 0);
  await page.locator('[data-dca-marker]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.dca-highlight').count(), 0, 'Sent notes must not paint permanent source highlights');
  assert.equal(await page.locator('.dca-sent-pills .dca-batch-chip').count(), 1);
  assert.equal(await page.getByText('[DSH_ANNOTATIONS_V1:', { exact: false }).count(), 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.dca-sent-pills .dca-batch-chip').waitFor();
  await assertSentLayout(0, 'sent-message-layout');
  assert.equal(await page.locator('[data-dca-marker]').count(), 0, 'Refresh must not restore sent source markers');
  assert.equal(await page.locator('.dca-highlight').count(), 0, 'Refresh must not restore sent source highlights');
  await screenshots('16-sent-idle-without-source-marks');
  await page.locator('.dca-sent-pills .dca-batch-chip').first().hover(); await page.locator('.dca-annotations').waitFor();
  assert.equal(await page.locator('.dca-annotation').count(), 2);
  await page.locator('.dca-quote').first().click();
  assert.equal(await page.locator('.dca-float').count(), 0, 'Sent quote navigation must close its details card');
  const assertSentSelection = async () => {
    await page.waitForFunction(quote => {
      const selection = window.getSelection();
      if (selection?.toString() !== quote || !selection.rangeCount) return false;
      const range = selection.getRangeAt(0), rect = range.getBoundingClientRect();
      const pane = range.startContainer.parentElement.closest('[data-conversation-scroll]');
      return rect.top > pane.getBoundingClientRect().top + 36 && rect.bottom < pane.querySelector('[data-composer-seat]').getBoundingClientRect().top - 12;
    }, referenceQuote);
    assert.equal(await page.locator('[data-dca-marker],.dca-highlight,.dca-float').count(), 0, 'Sent navigation must only select the source text');
  };
  await assertSentSelection();
  await screenshots('17-sent-source-selection');
  await input.click();
  assert.notEqual(await page.evaluate(() => window.getSelection()?.toString()), referenceQuote, 'Clicking elsewhere must clear the sent source selection');
  await page.locator('.dca-sent-pills .dca-batch-open').first().click();
  assert.equal(await page.locator('.dca-float').count(), 0, 'Clicking a sent annotation chip must jump without opening a popup');
  await assertSentSelection();
  await select('const greeting = "你好🙂";\nconsole.log(greeting);');
  await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 3 的可选评论', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 3 的可选评论' }).fill('代码注释\n保留中文与🙂');
  const codeMarker = page.locator('[data-dca-marker]').last(), codeId = await codeMarker.getAttribute('data-dca-marker');
  const codeTop = await page.locator(`[data-dca-highlight="${codeId}"]`).evaluateAll(elements => Math.min(...elements.map(el => el.getBoundingClientRect().top)));
  const codeMarkerBox = await codeMarker.boundingBox();
  assert.ok(codeMarkerBox.y + codeMarkerBox.height <= codeTop + 1, 'Multiline quote marker must not cover selected code');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('[data-dca-marker]').last().click(); await screenshots('06-dark');
  const darkPanel = await page.locator('.dca-editor').evaluate(el => getComputedStyle(el).backgroundColor);
  assert.notEqual(darkPanel, uiMeasurements.editor.background);
  uiMeasurements.darkBackground = darkPanel;
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.mouse.move(1200, 100); await measureControl('chip-dark', '.dca-dock .dca-batch-chip');
  await page.setViewportSize({ width: 480, height: 860 }); await page.locator('[data-dca-marker]').last().click();
  const box = await page.locator('.dca-editor').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 480);
  await screenshots('07-narrow'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
  // One click removes all pending notes and their reference, preserving native
  // text/files and sent notes. No detached chip or reattach step remains.
  await select('连续添加多条批注'); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 4 的可选评论' }).press('Enter');
  await input.click(); await input.press('End'); await page.keyboard.insertText('不带批注的草稿');
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('移除批注后仍保留附件🙂') }
  ]);
  await page.getByText('keep.txt', { exact: true }).waitFor();
  const draftBeforeClear = await input.innerText();
  await page.locator('.dca-dock .dca-batch-chip').hover();
  await page.getByRole('button', { name: '删除全部待发送批注', exact: true }).click();
  await page.locator('[data-dca-dock]').waitFor({ state: 'hidden' });
  await page.locator('.dca-marker').filter({ hasText: '3' }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.dca-highlight').count(), 0);
  assert.deepEqual(await page.locator('[data-dca-marker]').allTextContents(), []);
  assert.equal(await page.locator('.dca-sent-pills .dca-batch-chip').count(), 1);
  assert.equal(await page.locator('.dca-float').count(), 0);
  assert.equal(await page.getByRole('alertdialog').count(), 0);
  assert.equal(await input.locator('[data-composer-chip="dsh-codex-annotations"]').count(), 0);
  assert.equal((await input.innerText()).trim(), draftBeforeClear.trim());
  assert.equal(await page.getByText('keep.txt', { exact: true }).count(), 1);
  await screenshots('15-one-click-clear-preserves-draft');
  await page.reload({ waitUntil:'domcontentloaded' }); await input.waitFor();
  assert.equal(await page.locator('[data-dca-dock]').count(), 0, 'Removed batch must not return after refresh');
  assert.match(await input.innerText(), /不带批注的草稿/);
  await select('const greeting = "你好🙂";\nconsole.log(greeting);');
  await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 3 的可选评论' }).fill('代码注释\n保留中文与🙂');
  await page.getByRole('button', { name: '保存', exact:true }).click();
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.getByRole('checkbox', { name: '发送批注 3', exact: true }).uncheck();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('[data-chat-flow-kind="user"]').filter({ hasText: '不带批注的草稿' }).waitFor();
  await page.getByRole('button', { name: '0 条注释', exact: true }).hover();
  assert.equal(await page.getByRole('checkbox', { name: '发送批注 3', exact: true }).isChecked(), false);
  const ordinaryMessages = JSON.parse(await readFile(capturePath, 'utf8'));
  assert.ok(ordinaryMessages.some(m => m.content?.some(b => b.type === 'text' && b.text === '不带批注的草稿')));
  await page.getByRole('checkbox', { name: '发送批注 3', exact: true }).check();
  // Native file handling must remain available with a reference in the composer.
  await page.locator('input[type=file]').first().setInputFiles([
    { name: 'review.txt', mimeType: 'text/plain', buffer: Buffer.from('原生文件附件🙂\n') },
    { name: 'pixel.png', mimeType: 'image/png', buffer: await page.screenshot({ clip: { x: 0, y: 0, width: 2, height: 2 } }) }
  ]);
  await page.getByText('review.txt', { exact: true }).waitFor();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.dca-sent-pills .dca-batch-chip').nth(1).waitFor();
  await screenshots('08-native-files');
  const withFiles = JSON.parse(await readFile(capturePath, 'utf8'));
  const codeMessage = withFiles.find(m => m.content?.some(b => b.type === 'text' && modelNotes(b.text).some(a => a.number === 3)));
  assert.ok(codeMessage); const codeNotes = codeMessage.content.flatMap(b => b.type === 'text' ? modelNotes(b.text) : []);
  assert.equal(codeNotes[0].quote, 'const greeting = "你好🙂";\nconsole.log(greeting);');
  assert.equal(codeNotes[0].comment, '代码注释\n保留中文与🙂');
  assert.ok(codeMessage.content.some(b => b.type === 'image'));
  assert.ok(codeMessage.content.some(b => b.type === 'file' || b.type === 'text' && b.text.includes('review.txt')));
  // Session scope must not carry pending references into another conversation.
  await select('返回原文查看'); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 4 的可选评论', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 4 的可选评论' }).press('Enter');
  const other = rows.filter({ hasText: '另一会话' });
  if (await other.count()) await other.click(); else await rows.filter({ hasText: '未命名' }).click();
  await page.getByText('这是另一个会话，批注应相互独立。', { exact: true }).waitFor();
  assert.equal(await page.locator('[data-dca-marker]').count(), 0);
  assert.equal(await page.locator('[data-dca-dock]').count(), 0);
  await rows.filter({ hasText: '批注交互预览' }).click();
  await page.getByRole('button', { name: '批注 4，待发送', exact: true }).waitFor();
  // Fail serialization through the real native pipeline. The draft must be restored.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('dsh-codex-annotations:v1:') && Object.keys(JSON.parse(value).flights).length > 0)
        throw new Error('测试存储失败：批注未发送');
      return original.call(this, key, value);
    };
    window.__dcaRestoreStorage = () => { Storage.prototype.setItem = original; };
  });
  await input.click(); await input.press('End'); await page.keyboard.insertText('失败后应保留🙂');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.getByText('测试存储失败：批注未发送', { exact: true }).waitFor();
  assert.match(await input.innerText(), /失败后应保留🙂/);
  assert.equal(await input.locator('[data-composer-chip="dsh-codex-annotations"]').count(), 1);
  assert.equal(await page.getByRole('button', { name: '批注 4，待发送', exact: true }).count(), 1);
  await screenshots('09-failed-send-restores');
  await page.evaluate(() => window.__dcaRestoreStorage());
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('.dca-sent-pills .dca-batch-chip').nth(2).waitFor();
  assert.equal(await page.locator('[data-dca-dock]').count(), 0);
  await rows.filter({ hasText: '另一会话' }).click();
  await select('这是另一个会话'); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 1 的可选评论', exact: true }).click();
  await page.getByRole('button', { name: '删除批注 1', exact: true }).click();
  await page.locator('[data-dca-marker]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-dca-marker]').count(), 0, 'Editor delete must remove the source marker');
  await select('这是另一个会话'); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.getByRole('button', { name: '批注 1，待发送', exact: true }).waitFor();
  await page.locator('.dca-annotations').getByRole('button', { name: '删除批注 1', exact: true }).click();
  await page.locator('[data-dca-marker]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-dca-marker]').count(), 0, 'Popup delete must remove its source marker');
  assert.equal(await page.locator('[data-dca-dock]').count(), 0, 'Deleting the last annotation must remove the chip');
  // Exercise actual Cordis teardown and reactivation with retained historical notes.
  await rows.filter({ hasText: '批注交互预览' }).click();
  await select('这个插件会把选中的原文');
  await page.getByRole('button', { name:'添加到对话', exact:true }).click();
  await page.keyboard.press('Escape'); await input.press('Enter');
  await page.locator('.dca-user-message').nth(3).waitFor();
  await assertSentLayout(3, 'annotation-only-message-layout', true);
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 @deepseekharness-plugin/dsh-codex-annotations', exact: true }).click();
  await rows.filter({ hasText: '批注交互预览' }).click();
  const replies = page.getByText('本地测试已收到批注与用户要求。', { exact: true });
  const beforeDisableSend = await replies.count();
  await input.click(); await page.keyboard.insertText('停用后验证原始上下文'); await input.press('Enter');
  await replies.nth(beforeDisableSend).waitFor();
  const disabledMessages = JSON.parse(await readFile(capturePath, 'utf8'));
  assert.ok(disabledMessages.some(m => m.role === 'user' && m.content.some(b => b.type === 'text' && decodeText(b.text).payloads.length)), 'Disabling must restore the original public history reader');
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 @deepseekharness-plugin/dsh-codex-annotations', exact: true }).click();
  await rows.filter({ hasText: '批注交互预览' }).click();
  await page.locator('.dca-sent-pills .dca-batch-chip').nth(2).waitFor();
  const beforeReenableSend = await replies.count();
  await input.click(); await page.keyboard.insertText('再次启用验证历史批注'); await input.press('Enter');
  await replies.nth(beforeReenableSend).waitFor();
  const reenabledMessages = JSON.parse(await readFile(capturePath, 'utf8'));
  assert.ok(reenabledMessages.some(m => m.role === 'user' && m.content.some(b => b.type === 'text' && modelNotes(b.text).length)));
  assert.ok(!reenabledMessages.some(m => m.role === 'user' && m.content.some(b => b.type === 'text' && decodeText(b.text).payloads.length)), 'Reactivation must also slim retained historical annotations');
  await screenshots('18-model-projection-history');
  // The native compactor reads individual events rather than the cached history.
  await input.click(); await page.keyboard.insertText('/compact'); await input.press('Enter');
  await page.getByText(/^(已压缩 \d+ 条历史记录|Compacted \d+ history items)/).waitFor();
  const compactionMessages = JSON.parse(await readFile(capturePath, 'utf8'));
  assert.ok(compactionMessages.some(m => m.role === 'user' && m.content.some(b => b.type === 'text' && modelNotes(b.text).length)), 'The native compaction request must include the complete projected notes');
  assert.ok(!compactionMessages.some(m => m.role === 'user' && m.content.some(b => b.type === 'text' && decodeText(b.text).payloads.length)), 'Compaction must omit UI anchoring fields too');
  await writeFile(join(artifacts, 'compaction-model-request.json'), JSON.stringify(compactionMessages, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await writeFile(join(artifacts, 'ui-measurements.json'), JSON.stringify(uiMeasurements, null, 2));
  await writeFile(join(artifacts, 'verification.json'), JSON.stringify({ host: '0.2.0-rc.2', isolatedHome: home, errors, acceptedUser: last,
    modelProjection: { persistedUser: durable, projectedNotes, teardownRestored: true, reactivationProjectedHistory: true, compactionProjected: true },
    checks: ['sent-source-marks-cleared-and-stay-cleared-after-refresh', 'sent-native-selection-dismisses-on-next-click', 'enable-in-rendered-session', 'three-state-control-geometry', 'native-composer-chip', 'readable-count', 'cancel-preserves-comment', 'popup-pencil', 'long-answer-quote-jump-without-overlays', 'visible-clickable-quote-marker', 'tall-composer-and-editor-avoidance', 'navigation-preserves-draft', 'narrow-jump-and-edit', 'sent-quote-jump-without-overlays', 'editor-and-popup-delete', 'multiline-marker-clickable', 'selection-details', 'optional-comment', 'separate-numbers', 'refresh-restores-reference', 'legacy-detached-notes-restored-without-reattach-button', 'CJK-and-English-input', 'native-Enter', 'model-exact-quotes', 'accepted-clears-pending', 'sent-links', 'multiline-code', 'dark', 'narrow-editor', 'one-click-clear-without-confirmation', 'clear-preserves-text-files-and-sent-notes', 'cleared-batch-stays-cleared-after-refresh', 'reuses-deleted-number', 'unchecked-retained', 'native-button', 'image-and-file', 'session-isolation', 'failed-serialization-restores', 'retry'] }, null, 2));
  console.log('PASS real DSH native input; screenshots and evidence in artifacts/');
} catch (error) {
  if (page) { await screenshots('failure'); console.error(await page.locator('body').innerText()); }
  console.error('PAGE ERRORS', errors, 'CONSOLE', consoleErrors); throw error;
} finally {
  await browser?.close(); child?.kill('SIGTERM'); await writeFile(join(artifacts, 'host.log'), log);
}
