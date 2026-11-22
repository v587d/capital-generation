/** 中证指数官网 csindex-home JSON：指数 PE(TTM) 日序列。官网 JSON 没有 PB/静态 PE/股息率，
 * 那些只在 oss-ch 的 {code}indicator.xls 里，本仓无 xls 解析依赖，所以这一能力只承诺 pe_ttm。 */
import type { DataSource } from '../data-collector/hub.js';
export declare function createCsindexSources(): DataSource[];
