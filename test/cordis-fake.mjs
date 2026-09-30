/**
 * 给 host 平面行（`chart-ui` / `capital-watchlist`）的 `apply()` 用的 **cordis 形状** fake。
 *
 * 为什么单独一份、为什么这么别扭：2026-09-30 桌面端实机把两颗 host 行炸成 异常，报错是
 * `cannot get property "webServer" without inject`。代码写的是
 * `if (ctx.get('webServer') === undefined) ctx.inject(...) else registerRoute(ctx)`——
 * 而真实 cordis 里 **`ctx.get()` 能解析出值，不代表 `ctx.webServer` 属性访问合法**：
 * 属性只在"本层声明过 inject"的那个 ctx 上存在（见 cordis `ReflectService.handler.get`）。
 * 之前的 fake 直接把服务挂在外层 ctx 上，等于给这条错路发了通行证：测试全绿，真机异常。
 *
 * 所以这里复刻的是**实测语义**，不是方便断言的简化形状（AGENTS.md §9.7 第 ④ 条）。
 * 两颗行共用这一份——同一规则出现两份，就会有一颗行没被覆盖（这次正是如此）。
 */
export function fakeCtx({ webServer, connection, services = {} } = {}) {
  const provided = new Map(Object.entries(services))
  const injected = []
  const ctx = {
    get: (name) => (name === 'webServer' ? webServer : name === 'connection' ? connection : provided.get(name)),
    provide: (name, value) => provided.set(name, value),
    effect: (callback) => {
      callback()
      return () => {}
    },
    inject: (deps, callback) => {
      injected.push({ deps, callback })
      // 真实 cordis：依赖已就绪就立刻起这个子 fiber；没就绪就挂着等（本行仍算激活）。
      if (deps.every((dep) => ctx.get(dep) !== undefined)) callback(injectedCtx(deps))
    },
    logger: { info() {}, warn() {}, error() {} },
  }
  // 外层访问这个属性必须抛——不抛就测不出"探测后直接调用"那条错路。
  Object.defineProperty(ctx, 'webServer', {
    configurable: true,
    get() {
      throw new Error('cannot get property "webServer" without inject')
    },
  })
  /** inject 回调拿到的那一层：属性是自己拥有的，所以合法。 */
  const injectedCtx = (deps) => Object.create(ctx, deps.includes('webServer')
    ? { webServer: { value: webServer, configurable: true } }
    : {})
  return { provided, injected, ctx }
}
