[English](CONTRIBUTING.md) | 简体中文

# 参与 silkify

发现问题或有想法，请提 [issue](https://github.com/RussGuo/silkify/issues)；报 bug 有现成的模板。issue 里商量好的事，欢迎直接提 pull request。

## 规矩

- **默认外观一个像素都不能变。** 新参数默认都是关的；画廊 `examples/posters/` 里的静态图，除非那张卡本身改了，否则不重新渲染。跑一遍 `node scripts/shoot.mjs --posters` 再看 `git status`，就知道改动有没有动到任何一个像素。
- **每次提交前 `node scripts/shoot.mjs` 必须通过**（无头 Chrome，加装了 Pillow 的 Python；大约两分钟）。它不往仓库里写任何东西（外观确实变了时，`--shots` 会重写 `docs/shots/*-rest.jpg`）。CI 另外还跑 `--browsers`（WebKit 与 Firefox）和 `scripts/frameworks.mjs`（Vite 与 Next.js 里的 React）；两者都要 Playwright，但它永远不是本仓库的依赖。
- **给 Agent 看的文档只有一份源头。** 手写的只有 `SKILL.md` 和 `references/`；`AGENTS.md`、`llms.txt`、`integrations/` 里的一切，以及 Lab 里每个参数下面那行说明（`examples/lab-help.js`，取自 `references/parameters.md`）都是生成的：改源头，再跑 `npm run build:integrations`（加 `-- --check` 查漂移）。两份 README、画廊和 Lab 里的那句安装指令和作者署名，也由同一个脚本写入：要改就改脚本，不要改页面。
- **没有构建步骤，除了 three.js 没有运行时依赖。** 每个源文件不超过 800 行，开头有一段注释，说清它是什么、为什么这样做。
- 使用者能察觉到的改动，都要在 **[CHANGELOG.md](CHANGELOG.md)** 里记一笔。

在本地运行画廊和 Lab：在仓库根目录起一个静态服务器，再打开 `/examples/`。

```bash
npx serve .            # 或：python3 -m http.server
```

## 仓库结构

```
SKILL.md            Agent Skill：取得代码（拷贝 src/，或走 CDN）、抠图 → 穹面 → 材质与手感 → 渲染 → 验收
references/         参数全表、性能、常见问题：SKILL.md 按需指向的细节；how-it-works 是写给人看的原理
CHANGELOG.md        每个版本改了什么，以及版本 tag 承诺什么（看重完整性时钉 commit）
src/silk.js         入口：分档，Worker → 主线程 → 静态图三级退路，转发指针事件
src/core.js         渲染器本体，不碰 DOM（peer 依赖：three ≥ 0.152.2）
src/shaders.js      GLSL：波动求解器与物体着色器（同一份源码，两种形状）
src/worker.js       Web Worker 入口
src/presets.js      material 与 feel 预设：纯参数片段
src/tier.js         设备分档与按屏幕尺寸取分辨率
src/shape.js        轮廓 → 泊松穹面，纯数组，不依赖 three.js
src/live.js         活 HTML 的页面一侧：特性检测、元素的替身图、在页面里占住原位、快照、命中几何、退回普通 HTML
scripts/cutout.py   Pillow + numpy 背景抠除，能处理投影，边缘去背景色
scripts/shoot.mjs   无头 Chrome：校验（Worker 里实时渲染并起涟漪，再验 Lab、test/edge.html 与活 HTML）、--posters 静态帧、--gif 涟漪动图（ffmpeg）、--lab 预设效果图、--cdn 验 CDN 版、--browsers 验 WebKit 与 Firefox；控制台检查
scripts/verify-touch.mjs、scripts/verify-lab.mjs   shoot.mjs 的 verify 里单独成文件的两部分：第一下触摸与多对象；Lab 的文字与录制
scripts/build-integrations.mjs   SKILL.md + references → integrations/、AGENTS.md、llms.txt；两份 README、画廊和 Lab 里的那句安装指令与作者署名也由它写入（--check 查漂移）
scripts/browsers.mjs             shoot.mjs --browsers：WebKit 与 Firefox，同源与跨源（Playwright）
scripts/frameworks.mjs           React 组件在 Vite 与 Next.js 下的 dev 与 build 实测（Playwright，需联网）
scripts/harness.mjs              各检查脚本共用的静态服务器与 Playwright 加载
examples/           画廊、Lab 调参页、活 HTML 示例 live.html、CDN 用法的测试页 cdn.html（都是静态页面，GitHub Pages）、WebP 图片与静态帧、图片来源说明
examples/react, examples/next    带 React 组件的最小 Vite 与 Next.js 工程（图片用 Silk，活 HTML 用 SilkHtml）
test/edge.html      曾经静默失败的情形：SVG、空图或缺图、加载中的调用
test/live-edge.html 活 HTML 在常见布局下：卡片撑起舞台、卡片比画布大、SKILL.md 的片段在 375 px 宽下
integrations/       生成物：Cursor rule 与按路径生效的 Copilot instructions
AGENTS.md, llms.txt 生成物：给读 AGENTS.md 的 Agent，以及 llmstxt.org 格式的索引
.claude-plugin/     插件 marketplace 清单（Skill 本体是根目录的 SKILL.md）
.github/            CI（build:integrations --check、shoot.mjs、--cdn、--browsers、frameworks.mjs）与 issue 模板
```
