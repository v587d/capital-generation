DataCollectorHub（src/data-collector/hub.ts，约 330 行）
│
├── 缓存管理
│   ├── Map<cacheKey, CacheEntry>，cacheKey = data_key + stableHash(params)
│   ├── cacheKey 中的 data_key = 数据源规范身份证（provider.kind.resource，
│   │   斜杠/冒号已规范化为点，注册时由 buildDataKey 生成，全注册表唯一；
│   │   模型不造句，从 list_schemas 抄写）
│   ├── TTL 声明式：priority = source.schema.ttl_ms → options.ttlFor → defaultTtlMs
│   │   （fuyao 四源：快照/检索 60s，历史/日历 300s；不再按键名猜）
│   ├── 最大条目数限制（默认 500）
│   └── 懒清理（getLatest/写入时顺带清理）
│
├── 阻塞式消费（一次调用 = 入队 + 等待执行完成）
│   ├── 队列管理（最大 50，满则 request() 直接抛错）
│   ├── 同一时刻只执行一个请求（FIFO 串行）
│   ├── 执行超时（默认 30s，抛错 request timed out，释放执行位）
│   ├── 请求合并（相同 data_key+params 只执行一次，所有等待者共享同一结果）
│   └── 结果要么返回 CacheEntry，要么抛错；支持 exec.signal 中止（摘等待者，
│       不中止共享执行）
│
├── 数据源路由
│   ├── data_key 与注册身份证精确相等匹配
│   ├── source_preference 只做过滤：capability 名 > provider 令牌
│   │   （如 fuyao.api / ths 兼容别名）> 'any'
│   └── 无匹配/候选不唯一 → 失败（不静默选第一个）
│
└── 不存在的（刻意删除）
    ├── request_id / get_request_status / 状态表（阻塞式直接结算）
    └── data_key_patterns（改为精确匹配规范身份证）