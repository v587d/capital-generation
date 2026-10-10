import type { Context } from '@deepseek-ai/cordis';
/**
 * `capital-watchlist`（host 平面行）provide 的 `capitalWatchlist` 服务里，本工具用到的那一小片。
 * 声明成**可选方法 + 只读**：跨平面的形状归那一边所有，这里只描述"读清单"这条路径需要什么，
 * 任何多余字段都不进回包。清单的增删与持仓标记一律只在面板里做，Agent 侧没有写入口。
 */
interface WatchlistRow {
    readonly thscode?: string;
    readonly name?: string;
    readonly asset_type?: string;
    readonly added_at?: number;
    readonly pinned_at?: number;
    readonly holding?: {
        readonly weight_pct?: number | null;
        readonly marked_at?: number;
    };
}
interface WatchlistListResult {
    readonly ok?: boolean;
    readonly items?: WatchlistRow[];
    readonly limit?: number;
}
interface WatchlistServiceLike {
    list?(): Promise<WatchlistListResult>;
}
/** ToolOutputDefinition.render(args, value)：第一参是入参、第二参才是返回值。 */
declare function render(_args: unknown, value: unknown): Array<{
    type: 'text';
    text: string;
}>;
/** 成功回包。`limit` 只在宿主给了才带（那个数字归 `capital-watchlist` 所有，这里不抄一份）。 */
export declare function watchlistReceipt(rows: WatchlistRow[], limit: number | undefined, now: number): Record<string, unknown>;
export declare function watchlistToolDefinition(source: () => WatchlistServiceLike | undefined): {
    name: string;
    description: string;
    parameters: object;
    output: {
        schema: object;
        render: typeof render;
    };
    execute(): Promise<Record<string, unknown>>;
};
/**
 * 注册 `get_watchlist`（主 Agent 的工具；`capital-generation-scope` 组里注册 = 主 Agent 与
 * 全部 child 都看得见，所以通用 `subagent` 行必须把它 deny 掉，见 preset 的 agent.patch.yml）。
 *
 * 会话级数据（Dataset / profile / chart）走 workspace，而自选股是**宿主级用户资产**：
 * 本工具不读 `{{cwd}}`、不碰 `~/.dsh/storages/` 那个文件，只调那一路唯一的宿主服务
 * （设计文档 §2.4：不允许另建一份存储）。
 */
export declare function registerWatchlistTool(ctx: Context): void;
export {};
