/**
 * `capital:data-contract` system-prompt section: the single statement of how every Capital
 * role obtains data. Skills declare what evidence they need; this section says where it comes
 * from, so provider names and fetch recipes never live in skill prose.
 * Static text — registered per role by the selected-skills row, which every skill-loading role mounts.
 */
export const DATA_CONTRACT_SECTION = 'capital:data-contract'
/** Just before the selected-skill brief (order 60). */
export const DATA_CONTRACT_ORDER = 59

const TEXT = `# 数据边界

需要数据时，先看本角色是不是取数通道的承担者：不是，就向承担它的角色提请求；是，就用本角色的工具面执行。除这两条路，不自己访问 URL、API、数据库、终端或脚本，也不用训练记忆补数字。

- 结构化数据（行情、财务报表、宏观序列、持仓）→ 委派 data_collector
- 网页、披露文件、新闻、会议材料、PDF → 委派 web_retriever
- 已落库 Dataset 的计算、统计与出图 → 委派 data_junior
- 你自己就是上述某一侧的承担者时，用本角色的工具面执行，不越过该面

请求写清：标的或代码、证据类型（公告 / 财报 / 纪要 / 行情 / 宏观序列）、需要的字段或章节、期间与 as-of、频率、口径。"最新"必须带锚点日期。

每个数字都要带出处（场所、文档名、文档日期、accession 或该次检索返回的链接）、取数路径与缺口。缺字段就点名缺哪个并停止该字段下的分析，不估算、不回填；用户粘贴的材料标 pasted by user，不因此提高置信度。

skill 正文只写"要什么证据"，不写服务商、密钥、URL、下载步骤或脚本命令。`

/**
 * The senior analyst has no delegation right: its inputs arrive as an AnalysisSnapshot, and every
 * request for more goes through the lead. Same section name, different text — one home per role.
 */
const SENIOR_TEXT = `# 数据边界

你的输入由宿主冻结的 \`AnalysisSnapshot\` 给出：Dataset / profile / 证据都以 opaque ref 出现，快照在前、分析在后。你不取数、不检索、不读原始 rows，也没有 shell 或文件入口。

- 缺数据（快照里没有的字段、期间或来源）→ 经主 Agent 发 \`analysis_data_request\`，写清标的、字段、期间与用途；由主 Agent 决定是否扩大范围。
- 需要补计算（用快照里已有的 Dataset/profile）→ 也经主 Agent 转交，并在请求里带 task_id 与要算的口径；不自己找 data_collector / web_retriever。
- \`run_analysis\` 只返回指标、假设、缺口与 run ref；原始 rows 留在快照的宿主副本里，不会进你的上下文。

每个数字都要能被宿主追溯：claim 的 \`number_anchors\`、\`calculations\` 必须指向快照里的 dataset / profile / evidence 或本次计算，否则 \`submit_analysis\` 会拒。缺字段就点名缺哪个并写进 \`data_gaps\`，不估算、不回填、不用训练记忆补数字。用户粘贴的材料标 pasted by user，不因此提高置信度。

skill 正文只写"要什么证据"，不写服务商、密钥、URL、下载步骤或脚本命令。`

export interface DataContractSection {
  name: string
  order: number
  interpolate: false
  text: string
}

export function dataContractSection(role?: string): DataContractSection {
  const text = role === 'senior_analyst' ? SENIOR_TEXT : TEXT
  return { name: DATA_CONTRACT_SECTION, order: DATA_CONTRACT_ORDER, interpolate: false, text }
}
