// 官方 Worker 只实现 assert.ok；HMR 等模块还会使用严格相等断言。
// 补齐已核实的接口，其他未实现的 Node 能力继续由官方运行时明确拒绝。
export function installBrowserNodeCompat(builtins) {
  const factory = builtins['node:assert/strict']
  const original = factory()
  const equal = (actual, expected, message) => {
    if (Object.is(actual, expected)) return
    if (message instanceof Error) throw message
    throw Object.assign(new Error(message ?? 'Expected values to be strictly equal'), {
      name: 'AssertionError', code: 'ERR_ASSERTION', actual, expected, operator: 'strictEqual',
    })
  }
  const assertion = Object.assign((...args) => original.default(...args), original.default, { equal, strictEqual: equal })
  const replacement = () => ({ ...original, default: assertion, equal, strictEqual: equal })
  builtins['assert/strict'] = replacement
  builtins['node:assert/strict'] = replacement
}
