import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const project = resolve(new URL('..', import.meta.url).pathname);
const { version } = JSON.parse(await readFile(join(project, 'package.json')));
const cli = process.env.DCA_CLI ?? '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh';
const llmModule = process.env.DCA_LLM_MODULE ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
const root = await mkdtemp(join(tmpdir(), 'dca-readme-')), home = join(root, 'home'), workspace = join(root, 'workspace');
const profile = join(home, 'profiles/web'), artifacts = join(project, 'artifacts');
await mkdir(join(profile, 'node_modules/@deepseekharness-plugin'), { recursive: true });
await mkdir(workspace); await mkdir(artifacts, { recursive: true });
await symlink(project, join(profile, 'node_modules/@deepseekharness-plugin/dsh-codex-annotations'));
await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'dca-readme', private: true,
  dependencies: { '@deepseekharness-plugin/dsh-codex-annotations': `link:${project}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } } }));
await writeFile(join(profile, 'cordis.yml'), '[]');
await writeFile(join(profile, 'cordis.patch.yml'), JSON.stringify([{ id: 'ui-settings-general', config: { welcomeNoticeVersion: '2026-09-28.1' } }]));
const patch = join(root, 'test.patch.yml'), capturePath = join(artifacts, 'readme-model-request.json');
await writeFile(patch, JSON.stringify([
  ...['llm-deepseek', 'llm-pi-ai', 'session-title-llm'].map(id => ({ id, disabled: true })),
  { id: 'session-persistence-jsonl', config: { compression: 'none', root: join(home, 'sessions') } },
  { id: 'agent-default-model', config: { provider: 'dca-fixture', model: 'fixture' } },
  { insert: [{ id: 'dca-fixture', name: pathToFileURL(join(project, 'tests/mock-model.mjs')).href }] }
]));
const title = '批注使用示例';
const quote = '先选择回复中的文字，再写下修改意见。多条批注会在聊天框汇总，随下一条消息一起发送。';
const secondQuote = '发送后，原文上的编号会消失。点击消息里的「注释」，可以返回原文查看。';
const text = `## 为这段回答添加批注\n\n批注能让你直接指出需要调整的原文。\n\n${quote}\n\n${secondQuote}`;
const sourceDir = join(home, 'sessions', '-' + workspace.replaceAll('/', '-') + '--', 'session-dca-readme');
await mkdir(sourceDir, { recursive: true });
const now = Date.now(), block = { type: 'text', text };
const events = [
  { type: 'permission/preset', data: { preset: 'workspace-write' } },
  { type: 'sandbox/mode', data: { mode: 'workspace-write' } },
  { type: 'approval/policy', data: { policy: 'ask' } },
  { type: 'turn/start', data: { turn: 1 } }, { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'user/message', surfaceOp: 'append', data: { role: 'user', id: 'dca-readme-user', content: [{ type: 'text', text: '批注怎么使用？' }], source: { kind: 'user' } } },
  { type: 'session/title', data: { title, messageSeqs: [5], source: { kind: 'fallback' } } },
  { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1,
    message: { role: 'assistant', id: 'dca-readme-assistant', content: [block], source: { kind: 'model', provider: 'dca-fixture', model: 'fixture' } },
    stream: [
      { type: 'chunk', time: 7, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
      { type: 'text-chunks', time0: 7, index: 0, dt: [], texts: [text] },
      { type: 'chunk', time: 7, chunk: { type: 'block-end', index: 0, block } },
      { type: 'chunk', time: 7, chunk: { type: 'finish', reason: { kind: 'stop' } } }
    ] } },
  { type: 'step/end', data: { turn: 1, step: 1 } },
  { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }, { type: 'session/end-seed', data: {} }
];
await writeFile(join(sourceDir, 'session.v4.jsonl'), [JSON.stringify({ type: 'session', version: 4, id: 'session-dca-readme', createdAt: now, cwd: workspace, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }),
  ...events.map((event, seq) => JSON.stringify({ ...event, seq, time: now + seq + 1 }))].join('\n') + '\n');
const onlyDir = join(sourceDir, '../session-dca-readme-only'); await mkdir(onlyDir, { recursive: true });
const onlyEvents = events.map(event => event.type === 'session/title' ? { ...event, data: { ...event.data, title: '单独发送批注' } } : event);
await writeFile(join(onlyDir, 'session.v4.jsonl'), [JSON.stringify({ type: 'session', version: 4, id: 'session-dca-readme-only', createdAt: now - 1, cwd: workspace, isSeeded: false, delegationDepth: 0, agentPreset: 'standard' }),
  ...onlyEvents.map((event, seq) => JSON.stringify({ ...event, seq, time: now + seq + 1 }))].join('\n') + '\n');

let child, browser, page, log = '';
const errors = [], consoleErrors = [], shots = {};
try {
  child = spawn(cli, ['--profile', 'web', '--patch', patch, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    env: { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(root, 'agents'), DSH_TELEMETRY_DISABLED: '1', DCA_LLM_MODULE: llmModule, DCA_CAPTURE_PATH: capturePath }
  });
  child.stdout.on('data', data => { log += data; }); child.stderr.on('data', data => { log += data; });
  const deadline = Date.now() + 20000;
  while (!/dsh web: (http:\/\/\S+)/.test(log)) {
    if (Date.now() > deadline || child.exitCode !== null) throw new Error('Host boot failed: ' + log);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: process.env.DCA_BROWSER ?? 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 2, locale: 'zh-CN' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleErrors.push(message.text()); });
  page.setDefaultTimeout(12000);
  await page.goto(log.match(/dsh web: (http:\/\/\S+)/)[1], { waitUntil: 'domcontentloaded' });
  await page.locator('[contenteditable=true]').waitFor();
  const welcome = page.getByRole('button', { name: '继续', exact: true });
  if (await welcome.count()) await welcome.click();
  const rows = page.getByRole('treeitem'); await rows.first().waitFor();
  let target = rows.filter({ hasText: title });
  if (!await target.count()) target = rows.filter({ hasText: '未命名' }).first();
  await target.click();
  await page.locator('[data-chat-flow-kind="assistant-step"][data-chat-group-part="response"]').waitFor();
  await page.getByRole('button', { name: '插件', exact: true }).click();
  await page.getByRole('switch', { name: '启用 @deepseekharness-plugin/dsh-codex-annotations', exact: true }).click();
  target = rows.filter({ hasText: title });
  if (!await target.count()) target = rows.filter({ hasText: '未命名' }).first();
  await target.click();
  const body = page.locator('[data-dca-content]').first(), input = page.locator('[contenteditable=true]').first();
  await body.waitFor(); await page.evaluate(() => document.fonts.ready);
  assert.equal(await body.locator('..').getAttribute('data-dca-session'), 'session-dca-readme');
  const frame = await page.locator('[data-conversation-scroll]').evaluate(el => ({
    x: el.getBoundingClientRect().left, y: 0, width: innerWidth - el.getBoundingClientRect().left, height: innerHeight
  }));
  assert.ok(frame.width >= 700, 'Capture the whole conversation pane, not an individual control');
  const select = async selectedText => {
    await body.click();
    await body.evaluate((el, selectedText) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), nodes = []; let full = '';
      for (let node; (node = walker.nextNode());) { nodes.push({ node, start: full.length, end: full.length + node.length }); full += node.data; }
      const at = full.indexOf(selectedText); if (at < 0) throw new Error('Missing quote');
      const first = nodes.find(node => node.end > at), last = [...nodes].reverse().find(node => node.start < at + selectedText.length);
      const range = document.createRange(); range.setStart(first.node, at - first.start); range.setEnd(last.node, at + selectedText.length - last.start);
      first.node.parentElement.scrollIntoView({ block: 'center', behavior: 'instant' });
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    }, selectedText);
    await page.getByRole('button', { name: '添加到对话', exact: true }).click();
  };
  const capture = async (name, selectors) => {
    const bounds = await page.evaluate(async selectors => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return selectors.map(selector => {
        const rect = selector === ':selection' ? window.getSelection().getRangeAt(0).getBoundingClientRect() : document.querySelector(selector).getBoundingClientRect();
        return { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      });
    }, selectors);
    for (const rect of bounds) assert.ok(rect.left >= frame.x && rect.top >= 0 && rect.right <= frame.x + frame.width && rect.bottom <= frame.height,
      `${name}: ${rect.selector} must be entirely visible`);
    await page.screenshot({ path: join(project, 'docs/assets', `${name}.png`), scale: 'device', clip: frame, animations: 'disabled' });
    shots[name] = { width: Math.round(frame.width * 2), height: Math.round(frame.height * 2), bounds };
  };
  await select(quote);
  const comment = page.getByRole('textbox', { name: '批注 1 的可选评论', exact: true });
  await comment.waitFor(); await page.locator('.dca-highlight').waitFor();
  await capture('readme-add', ['.dca-source', '.dca-editor', '.dca-marker', '[data-composer-seat]']);
  await comment.click(); await comment.fill('补充一个具体例子，说明怎么使用。');
  await capture('readme-edit', ['.dca-source', '.dca-editor', '.dca-marker', '[data-composer-seat]']);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '1 条注释', exact: true }).hover();
  await page.locator('.dca-annotations').waitFor();
  await capture('readme-list', ['.dca-annotations', '.dca-dock', '[data-composer-seat]']);
  await input.click(); await page.keyboard.insertText('请根据批注补充具体例子。'); await input.press('Enter');
  await page.getByText('本地测试已收到批注与用户要求。', { exact: true }).waitFor();
  await page.locator('[data-dca-marker]').waitFor({ state: 'hidden' });
  const sent = page.locator('.dca-user-message').first();
  const assertSentLayout = async row => {
    const layout = await row.evaluate(el => {
      const header = el.querySelector('.dca-sent-pills'), native = header.nextElementSibling, actions = native.querySelector('[data-clock="start"]');
      return { headerBottom: header.getBoundingClientRect().bottom, nativeTop: native.getBoundingClientRect().top,
        nativeActionsLast: actions.contains([...el.querySelectorAll('button')].at(-1)), paddingTop: getComputedStyle(el).paddingTop };
    });
    assert.ok(layout.headerBottom <= layout.nativeTop); assert.ok(layout.nativeActionsLast);
    return layout;
  };
  const sentLayout = await assertSentLayout(sent);
  await page.locator('[data-conversation-scroll]').evaluate(el => { el.scrollTop = 0; });
  await sent.locator('[data-clock="start"]').hover();
  await capture('readme-sent-message', ['.dca-user-message', '[data-composer-seat]']);
  await page.locator('.dca-sent-pills .dca-batch-open').first().click();
  await page.waitForFunction(quote => window.getSelection()?.toString() === quote, quote);
  assert.equal(await page.locator('.dca-float,.dca-marker,.dca-highlight').count(), 0);
  await page.locator('[data-conversation-scroll]').evaluate(el => { el.scrollTop = 0; });
  await capture('readme-sent', [':selection', '.dca-user-message', '[data-composer-seat]']);
  target = rows.filter({ hasText: '单独发送批注' });
  if (!await target.count()) target = rows.filter({ hasText: '未命名' }).first();
  await target.click();
  await body.waitFor(); assert.equal(await body.locator('..').getAttribute('data-dca-session'), 'session-dca-readme-only');
  await select(secondQuote); await page.keyboard.press('Escape'); await input.press('Enter');
  await page.getByText('本地测试已收到批注与用户要求。', { exact: true }).waitFor();
  const only = page.locator('.dca-user-message-annotations-only'); await only.waitFor();
  const onlyLayout = await assertSentLayout(only); assert.equal(onlyLayout.paddingTop, '16px');
  await page.locator('[data-conversation-scroll]').evaluate(el => { el.scrollTop = 0; });
  await only.locator('[data-clock="start"]').hover();
  await capture('readme-annotation-only', ['.dca-user-message-annotations-only', '[data-composer-seat]']);
  assert.deepEqual(errors, []); assert.deepEqual(consoleErrors, []);
  await writeFile(join(artifacts, 'readme-screenshots.json'), JSON.stringify({ host: '0.2.0-rc.2', version, deviceScaleFactor: 2,
    viewport: { width: 1100, height: 760 }, frame, shots, sentLayout, onlyLayout, errors, consoleErrors }, null, 2));
  console.log(`Captured six full conversation views at 2x from plugin ${version}.`);
} catch (error) {
  if (page) await page.screenshot({ path: join(artifacts, 'readme-capture-failure.png'), scale: 'device' });
  console.error('PAGE ERRORS', errors, 'CONSOLE', consoleErrors); throw error;
} finally {
  await browser?.close(); child?.kill('SIGTERM');
  await writeFile(join(artifacts, 'readme-host.log'), log);
}
