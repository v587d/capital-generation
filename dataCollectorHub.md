DataCollectorHub（src/data-collector/hub.ts，约 340 行）
│
├── 缓存管理
│   ├── Map<cacheKey, CacheEntry> 缓存存储
│   ├── TTL 过期机制（快照 60s，其余 300s）
│   ├── 最大条目数限制（默认 500）
│   └── 懒清理（getLatest/写入时顺带清理）
│
├── FIFO 串行执行器
│   ├── 队列管理（最大 50）
│   ├── 同一时刻只执行一个请求
│   ├── 超时机制（默认 30s）
│   └── 请求合并（相同 data_key + params 只执行一次）
│
├── 数据源路由
│   ├── 按 data_key_patterns 匹配
│   ├── source_preference 优先级
│   └── 歧义检测（候选不唯一时失败）
│
└── 请求状态管理
    ├── 状态跟踪（enqueued/running/completed/failed）
    └── 最大记录数限制（默认 1000）