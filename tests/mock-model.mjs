import { writeFile } from 'node:fs/promises';
const { LlmAdapter } = await import(process.env.DCA_LLM_MODULE);
export const inject = ['llm'];
class Fixture extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: '本地测试模型' }; }
  async listModels(provider) { return [{ provider, id: 'fixture', name: '本地测试模型', contextWindow: 128000 }]; }
  async resolveModel(provider, id) { return { provider, id, name: '本地测试模型', contextWindow: 128000 }; }
  async *stream(options) {
    await writeFile(process.env.DCA_CAPTURE_PATH, JSON.stringify(options.messages, null, 2));
    const system = options.messages.filter(message => message.role === 'system')
      .flatMap(message => message.content.map(block => block.text ?? '')).join('\n');
    const numbers = new Set(options.messages.filter(message => message.role === 'user').flatMap(message =>
      message.content.flatMap(block => block.type === 'text' ? [...block.text.matchAll(/\[用户批注\]\n[^\n]*\n([^\n]*)\n\[\/用户批注\]/g)]
        .flatMap(match => JSON.parse(match[1]).map(note => note.number)) : [])));
    const citations = system.includes('用户批注引用')
      ? [...numbers].map(number => `[注释 ${number}](https://dsh-annotations.invalid/${number})`).join(' ') : '';
    const text = '本地测试已收到批注与用户要求。' + (citations ? '\n\n已按原文逐条处理。' + citations : '');
    yield { type: 'block-start', index: 0, blockType: 'text' };
    // Exercise native incremental Markdown, including a split citation destination.
    for (let offset = 0; offset < text.length; offset += 13)
      yield { type: 'text-delta', index: 0, text: text.slice(offset, offset + 13) };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export function apply(ctx) { ctx.effect(() => ctx.llm.registerAdapter(['dca-fixture'], new Fixture())); }
