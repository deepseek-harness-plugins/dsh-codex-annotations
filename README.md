# DSH Codex Annotations

在 DeepSeek Harness 的助手原文旁添加批注，以 Codex 的选区交互为参考：选择文字 → **添加到对话** → 蓝色编号 → **添加可选评论…** → 随下一条消息发送。

![原文旁的批注编辑器](docs/assets/inline-comment.png)

## 使用

1. 在助手回复里选择文字，点击浮动菜单的「添加到对话」。
2. 写评论，或直接按 Enter 保留空评论。Shift+Enter 换行；Escape/点击外部收起编辑器。评论输入时即保存。
3. 继续选择其他文字。每条批注保留独立编号；点击蓝色编号或输入框上方的批注可重新编辑。
4. 在原生输入框写本轮要求，按 Enter 或点击原生发送按钮。也可以只发送批注。
5. 已发送消息下面的批注胶囊可查看完整原文、评论，并「回到原文」。

「更多详情」显示完整选区。输入框上方的列表支持勾选、取消附加和删除。未勾选的批注保留到后续消息，取消附加后正常输入不会自行重新附加。

## 安装

适用于 **DSH Desktop / Web 0.2.0-rc.2**。这是首个自研版本，尚未发布到 npm。仓库包含构建产物，可直接打包本地安装：

```sh
cd /path/to/dsh-codex-annotations
npm pack
dsh plugin --profile desktop add /path/to/deepseekharness-plugin-dsh-codex-annotations-0.1.1.tgz
```

使用 Web 时把 `desktop` 换成 `web`。如果系统没有 `dsh` 命令，macOS 应用内的入口为：

```sh
'/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh' plugin --profile desktop add /absolute/path/to/deepseekharness-plugin-dsh-codex-annotations-0.1.1.tgz
```

安装后重新打开 DSH。首次试用时建议暂时停用其他选区/批注插件，避免多个菜单同时出现。CLI/TUI 不提供这些图形交互。

## 保存与发送

- 批注按会话保存在当前浏览器/桌面应用的 `localStorage` 中，刷新和切换会话可恢复。浏览器清除站点数据会清除草稿；不同浏览器、设备之间不自动同步。
- 使用 dsh 原生 `inputTriggers` 引用编解码和会话输入事件；不访问 Lexical 私有字段，不覆盖发送方法，不注册隐藏命令，不拦截 Enter。
- 原生输入框中只有「@ 批注」引用。发送时由 dsh 编码为完整 JSON 批注资料，模型收到原文、可选评论和本轮要求。会话界面保留要求正文与可点击的批注胶囊。
- 序列化不会清空草稿。收到原生会话或队列中的已接收用户消息后，才把对应版本的批注标为已发送。模型后续报错不等于消息未提交；发送前失败则保留批注，并由原生输入框恢复草稿及附件。
- 保留原文与评论的实际字符，不脱敏、不裁剪。存储容量不足时明确报错，不宣称已保存。段落之间用换行、同一表格行的单元格之间用制表符表示渲染结构。
- 定位依据来源节点、选区和前后文。原文变化且存在歧义时，明确提示无法准确定位。未加载的历史消息需要先向上加载，批注胶囊仍能展示完整引用。

## 与 Codex 的边界

本项目实现用户提供截图中的主要交互，未声称与 Codex 的全部行为或内部协议一致。首版范围是助手回复中的文本、Markdown、代码和表格；不包含文件编辑器中的行号审查批注。多个浏览器标签页同时编辑同一会话不提供事务隔离保证。

按项目要求不提供语音输入。

## 开发与验证

Node.js 24 或更新版本：

```sh
npm ci
npm run check
npm run test:host
```

`test:host` 启动独立测试配置和本地固定回复模型，不使用真实模型服务，也不修改日常 DSH 配置。默认使用 macOS DSH 应用和 Chrome；其他安装路径可通过 `DCA_CLI`、`DCA_LLM_MODULE`、`DCA_BROWSER` 指定。

测试截图、模型实际收到的消息和测试证据输出到 `artifacts/`；该目录不提交。详细验证范围见 [验证记录](docs/verification.md) 与 [UI 尺寸对照](docs/ui-comparison.md)。

## 结构

| 文件 | 职责 |
| --- | --- |
| `src/core.js` | 完整批注资料、持久化、发送确认和精确定位 |
| `src/ranges.js` | 选区与渲染文本之间的映射 |
| `src/runtime.js` | 原生会话、引用输入和队列接入 |
| `src/client.jsx` | 保留原生渲染器，加入菜单、编号、评论和批注胶囊 |
| `lib/` | 可安装的构建产物 |

MIT License。项目与 OpenAI/Codex 无官方关联。
