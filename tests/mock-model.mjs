import { writeFile } from 'node:fs/promises';
const { LlmAdapter } = await import(process.env.DCA_LLM_MODULE);
export const inject = ['llm'];
class Fixture extends LlmAdapter {
  providerInfo(provider) { return { id: provider, name: '本地测试模型' }; }
  async listModels(provider) { return [{ provider, id: 'fixture', name: '本地测试模型', contextWindow: 128000 }]; }
  async resolveModel(provider, id) { return { provider, id, name: '本地测试模型', contextWindow: 128000 }; }
  async *stream(options) {
    await writeFile(process.env.DCA_CAPTURE_PATH, JSON.stringify(options.messages, null, 2));
    const text = '本地测试已收到批注与用户要求。';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
export function apply(ctx) { ctx.effect(() => ctx.llm.registerAdapter(['dca-fixture'], new Fixture())); }
