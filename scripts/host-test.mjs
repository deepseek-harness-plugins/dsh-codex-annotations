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
  { insert: [{ id: 'dca-fixture', name: pathToFileURL(join(project, 'tests/mock-model.mjs')).href }] }
]));
const referenceQuote = '失的是助手回答正文，用量数字还在。这和刚才启用插件时出现的显示问题一致；我先检查你现在的窗';
const fixtureText = '这个插件会把选中的原文和你的评论随下一条消息一起发给模型。你可以连续添加多条批注，并随时返回原文查看。\n\n```js\nconst greeting = "你好🙂";\nconsole.log(greeting);\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 空评论 | 支持 |\n| 多条批注 | 支持 |\n\n截图里消失的是助手回答正文，用量数字还在。这和刚才启用插件时出现的显示问题一致；我先检查你现在的窗口，再定位插件为何会把正文隐藏。';
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
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, text);
    await page.getByRole('button', { name: '添加到对话', exact: true }).waitFor();
  };
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
  await page.getByRole('button', { name: '1 条注释', exact: true }).click();
  await measureControl('annotations', '.dca-annotations');
  assert.equal(uiMeasurements.annotations.width, 384);
  assert.equal(uiMeasurements.annotations.height, 143);
  assert.equal(uiMeasurements.annotations.x, uiMeasurements['batch-chip'].x, 'Popup must align with the chip border');
  assert.equal(await page.locator('.dca-quote').innerText(), referenceQuote);
  assert.equal(await page.locator('.dca-comment').innerText(), '测试1');
  await screenshots('11-composer-annotations');
  await page.locator('.dca-annotations').getByRole('button', { name: '编辑批注 1', exact: true }).click();
  assert.equal(await comment.inputValue(), '测试1', 'Popup pencil must edit the saved comment');
  assert.equal(await page.getByText('原文已变化，无法准确定位；批注原文仍保留。', { exact: true }).count(), 0, 'Folded reasoning must not handle a response quote');
  assert.equal(await page.locator('[data-chat-group-part="reasoning"] .dca-source').count(), 0);
  assert.ok(await page.locator('[data-chat-group-part="response"] .dca-source').count() > 0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await select('连续添加多条批注'); await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 2 的可选评论', exact: true }).click();
  await page.getByRole('textbox', { name: '批注 2 的可选评论' }).press('Enter');
  await page.locator('[data-dca-marker]').nth(1).waitFor(); await screenshots('03-numbered-anchors');
  assert.deepEqual(await page.locator('[data-dca-marker]').allTextContents(), ['1', '2']);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-dca-marker]').nth(1).waitFor();
  assert.deepEqual(await page.locator('[data-dca-marker]').allTextContents(), ['1', '2']);
  await screenshots('04-restored-draft');
  const input = page.locator('[contenteditable=true]').first(); await input.click(); await input.press('End');
  await page.keyboard.insertText('请按批注修改。'); await input.pressSequentially(' Keep English.');
  assert.match(await input.innerText(), /请按批注修改。 Keep English\./);
  await input.press('Enter'); await page.getByText('本地测试已收到批注与用户要求。', { exact: true }).waitFor();
  await screenshots('05-sent-annotations');
  const messages = JSON.parse(await readFile(capturePath, 'utf8')), last = messages.filter(m => m.role === 'user' && m.content?.some(b => b.type === 'text' && decodeText(b.text).payloads.length)).at(-1);
  const text = last.content.filter(b => b.type === 'text').map(b => b.text).join(''); const decoded = decodeText(text);
  assert.match(decoded.text, /请按批注修改。 Keep English\./);
  assert.equal(decoded.payloads.length, 1); assert.equal(decoded.payloads[0].annotations.length, 2);
  assert.equal(decoded.payloads[0].annotations[0].quote, referenceQuote);
  assert.equal(decoded.payloads[0].annotations[0].comment, '测试1');
  assert.equal(decoded.payloads[0].annotations[1].comment, '');
  assert.equal(await page.locator('[data-dca-dock]').count(), 0);
  assert.equal(await page.locator('.dca-sent-pills .dca-batch-chip').count(), 1);
  assert.equal(await page.getByText('[DSH_ANNOTATIONS_V1:', { exact: false }).count(), 0);
  await page.locator('.dca-sent-pills .dca-batch-chip').first().click(); await page.locator('.dca-annotations').waitFor();
  assert.equal(await page.locator('.dca-annotation').count(), 2);
  await page.keyboard.press('Escape');
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
  await page.setViewportSize({ width: 480, height: 860 }); await page.locator('[data-dca-marker]').last().click();
  const box = await page.locator('.dca-editor').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 480);
  await screenshots('07-narrow'); await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: 'light' });
  // Detaching is an explicit send decision and must survive subsequent typing.
  await page.getByRole('button', { name: '取消附加批注', exact: true }).click();
  await input.click(); await page.keyboard.insertText('不带批注的草稿');
  assert.ok(!await input.innerText().then(t => /@\s*批注/.test(t)));
  await page.getByRole('button', { name: '附加批注', exact: true }).click();
  assert.match(await input.innerText(), /不带批注的草稿/);
  await page.getByRole('button', { name: '1 条注释', exact: true }).click();
  await page.getByRole('checkbox', { name: '发送批注 3', exact: true }).uncheck();
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await page.locator('[data-chat-flow-kind="user"]').filter({ hasText: '不带批注的草稿' }).waitFor();
  await page.getByRole('button', { name: '0 条注释', exact: true }).click();
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
  const codeMessage = withFiles.find(m => m.content?.some(b => b.type === 'text' && decodeText(b.text).payloads.some(p => p.annotations.some(a => a.number === 3))));
  assert.ok(codeMessage); const codePayload = codeMessage.content.flatMap(b => b.type === 'text' ? decodeText(b.text).payloads : [])[0];
  assert.equal(codePayload.annotations[0].quote, 'const greeting = "你好🙂";\nconsole.log(greeting);');
  assert.equal(codePayload.annotations[0].comment, '代码注释\n保留中文与🙂');
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
  await page.getByRole('button', { name: '1 条注释', exact: true }).click();
  await page.locator('.dca-annotations').getByRole('button', { name: '删除批注 2', exact: true }).click();
  await page.locator('[data-dca-marker]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-dca-marker]').count(), 0, 'Popup delete must remove its source marker');
  assert.equal(await page.locator('[data-dca-dock]').count(), 0, 'Deleting the last annotation must remove the chip');
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
  await writeFile(join(artifacts, 'ui-measurements.json'), JSON.stringify(uiMeasurements, null, 2));
  await writeFile(join(artifacts, 'verification.json'), JSON.stringify({ host: '0.2.0-rc.2', isolatedHome: home, errors, acceptedUser: last,
    checks: ['enable-in-rendered-session', 'three-state-control-geometry', 'native-composer-chip', 'readable-count', 'cancel-preserves-comment', 'popup-pencil', 'editor-and-popup-delete', 'multiline-marker-clickable', 'selection-details', 'optional-comment', 'separate-numbers', 'refresh-restores-reference', 'CJK-and-English-input', 'native-Enter', 'model-exact-quotes', 'accepted-clears-pending', 'sent-links', 'multiline-code', 'dark', 'narrow-editor', 'detach-and-reattach', 'unchecked-retained', 'native-button', 'image-and-file', 'session-isolation', 'failed-serialization-restores', 'retry'] }, null, 2));
  console.log('PASS real DSH native input; screenshots and evidence in artifacts/');
} catch (error) {
  if (page) { await screenshots('failure'); console.error(await page.locator('body').innerText()); }
  console.error('PAGE ERRORS', errors, 'CONSOLE', consoleErrors); throw error;
} finally {
  await browser?.close(); child?.kill('SIGTERM'); await writeFile(join(artifacts, 'host.log'), log);
}
