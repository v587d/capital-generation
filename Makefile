# capital-generation 本地开发入口 (v0.3.0 M6)
.PHONY: ci quick test lint sync-symbols lake

ci:            ## 全量本地 CI (ruff + pytest 离线 + 契约漂移 + symbols 新鲜度)
	uv run python scripts/ci.py

quick:         ## 快速 gate (ruff + 测试; pre-commit 同款)
	uv run python scripts/ci.py --quick

test:
	uv run pytest tests -q

lint:
	uv run ruff check . && uv run ruff format --check .

sync-symbols:  ## 刷新 symbols.json (需 THS_API_KEY; --if-stale 30 自动跳过新鲜快照)
	uv run python scripts/sync-symbols.py --if-stale 30

lake:          ## 数据湖: 同步/校验/重建 (离线资产, 不进 LLM)
	uv run python scripts/lake.py status
