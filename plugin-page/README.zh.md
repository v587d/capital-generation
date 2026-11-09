[![npm version](https://img.shields.io/npm/v/%40v587d%2Fcapital-generation)](https://www.npmjs.com/package/@v587d/capital-generation)
[![Market](https://img.shields.io/badge/Market-CN%20%7C%20HK%20%7C%20US-orange)](https://github.com/v587d/capital-generation)
[![Financial Agent](https://img.shields.io/badge/Financial-Agent-red)](https://github.com/v587d/capital-generation)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/License-MIT-green)](https://github.com/v587d/capital-generation/blob/main/LICENSE)
[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

Capital Generation 是运行在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 里的证券研究插件，面向关注 A 股、港股、美股与期货等品种的个体投资者。安装后，新会话里会多出 **自动模式**、**行情专家**、**资讯专员** 三个模式。

> **注意**：本项目仍在探索中，不提供代交易服务，不保证数据完整、及时或准确，也不承诺投资回报。请自行核对来源并承担投资风险。

## 第一次使用

1. 打开「插件」→ **Capital Generation**；配置卡就在**本文下方**。
2. 按需填写密钥（可以留空）；保存后新建会话。
3. 新建会话，选择 **自动模式**。

安装、密钥与桌面端说明见 [README 快速上手](https://github.com/v587d/capital-generation#快速上手)。

## 三种模式

| 模式 | 一句话 |
|---|---|
| **自动模式**（推荐） | 统一调度取数、质检、检索与绘图，汇总证据后答复 |
| **行情专家** | 只取结构化行情、财务或宏观数据，不做判断 |
| **资讯专员** | 只查公告、新闻与互动平台材料，不给建议 |

自动模式不直接取数，也不直接画图；每个数字都要有来源与截止时间。完整说明见 [README 三种模式](https://github.com/v587d/capital-generation#快速上手)。

## CapGen 投研自动化

内置多套任务模板，覆盖资讯、行情、复盘、研究、组合与监控；到点自动新建会话执行，也能手动运行。任务、看板、运行热力图与通知在同一页。

模板清单、运行预算与通知设置见 [README 的 CapGen 投研自动化](https://github.com/v587d/capital-generation#capgen-automation)。

## 版本与回滚

- 插件页的「版本」段只检查比当前更新的版本；旧版本不会出现在列表里。
- 回旧版：先卸载，再安装 `@v587d/capital-generation@版本号`；桌面端地址末尾加 `#v版本号`。
- 旧版本必须与当前 DSH 基线匹配；对应关系见 [CHANGELOG 的 Migration](https://github.com/v587d/capital-generation/blob/main/CHANGELOG.md)。

## 更多

- [完整 README](https://github.com/v587d/capital-generation#readme)
- [数据收集能力表](https://github.com/v587d/capital-generation/blob/main/docs/data-collector-capabilities.md)
- [网页检索能力表](https://github.com/v587d/capital-generation/blob/main/docs/web-retriever-capabilities.md)
- [投研自动化](https://github.com/v587d/capital-generation#capgen-automation)
- [常见问题](https://github.com/v587d/capital-generation#常见问题)
- [更新日志](https://github.com/v587d/capital-generation/blob/main/CHANGELOG.md)
