[![npm version](https://img.shields.io/npm/v/%40v587d%2Fcapital-generation)](https://www.npmjs.com/package/@v587d/capital-generation)
[![Market](https://img.shields.io/badge/Market-CN%20%7C%20HK%20%7C%20US-orange)](https://github.com/v587d/capital-generation)
[![Financial Agent](https://img.shields.io/badge/Financial-Agent-red)](https://github.com/v587d/capital-generation)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-plugin-blue)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/License-MIT-green)](https://github.com/v587d/capital-generation/blob/main/LICENSE)
[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

Capital Generation is a securities research plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), built for individual investors following A-shares, Hong Kong, US markets and futures. After installation, new sessions offer **Auto**, **Market Expert**, and **News Specialist** modes.

> **Note**: This project is exploratory. It does not provide trading services, does not guarantee data completeness, timeliness or accuracy, and does not promise investment returns. Verify sources and accept market risk yourself.

## First use

1. Open **Plugins** → **Capital Generation**; the configuration card is **below this document**.
2. Fill in the keys you need (they can be left empty); new sessions pick up saved keys.
3. Create a session and choose **Auto**.

See [README quick start](https://github.com/v587d/capital-generation#快速上手) for installation, keys and desktop notes.

## Modes

| Mode | In one line |
|---|---|
| **Auto** (recommended) | Schedules data collection, checks, retrieval and charts, then answers with evidence |
| **Market Expert** | Fetches structured market, financial or macro data only; makes no judgment |
| **News Specialist** | Retrieves filings, news and interactive-platform material only; gives no advice |

Auto never fetches data or draws charts directly; every number needs a source and an as-of time. See [README modes](https://github.com/v587d/capital-generation#快速上手) for the full table.

## CapGen research automation

Built-in task templates cover news, quotes, reviews, research, portfolios and monitoring; they start a new session on schedule and can also be run manually. Tasks, the board, the run heatmap and notifications live on one page. Board TODOs are checked automatically alongside the Midday Snapshot and Daily Review runs; when a condition triggers or needs your confirmation, it lands in task notifications.

See [README CapGen automation](https://github.com/v587d/capital-generation#capgen-automation) for templates, budgets and notifications.

## Versions and rollback

- The **Versions** section only checks for versions newer than the installed one; older versions are never listed.
- To roll back: uninstall, then install `@v587d/capital-generation@version`; on Desktop, append `#vversion` to the address.
- An older version must match the running DSH baseline; see [CHANGELOG Migration](https://github.com/v587d/capital-generation/blob/main/CHANGELOG.md).

## More

- [Full README](https://github.com/v587d/capital-generation#readme)
- [Data collection capabilities](https://github.com/v587d/capital-generation/blob/main/docs/data-collector-capabilities.md)
- [Web retrieval capabilities](https://github.com/v587d/capital-generation/blob/main/docs/web-retriever-capabilities.md)
- [Research automation](https://github.com/v587d/capital-generation#capgen-automation)
- [FAQ](https://github.com/v587d/capital-generation#常见问题)
- [Changelog](https://github.com/v587d/capital-generation/blob/main/CHANGELOG.md)
