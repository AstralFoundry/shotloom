// 官方 sink 将写入视为已完成，因此另设粘滞失败状态；所有外部副作用都必须经过 barrier。
export function createDurableVfsSink({ commit, onFailure }) {
  let pending = Promise.resolve(), failure
  let changes = new Map()
  const known = new Set()
  const failed = error => { if (!failure) { failure = error; onFailure?.(error) } }
  const enqueue = () => {
    if (!changes.size || failure) return pending
    const files = [...changes].map(([path, data]) => ({ path, data }))
    changes = new Map()
    pending = pending.then(() => commit(files)).catch(failed)
    return pending
  }
  return {
    // 恢复只登记路径，不重新读取历史文件；目录删除时仍能清理已落盘的后代。
    remember(path) { known.add(path) },
    record(mutation) {
      if (failure || (mutation.path !== '/dsh/state' && !mutation.path.startsWith('/dsh/state/'))) return
      try {
        if (mutation.kind === 'write') {
          known.add(mutation.path)
          changes.set(mutation.path, mutation.bytes.slice())
        } else if (mutation.kind === 'remove') {
          for (const path of known) if (path === mutation.path || path.startsWith(mutation.path + '/')) {
            changes.set(path, null); known.delete(path)
          }
        }
      } catch (error) { failed(error) }
    },
    async flush() { await enqueue() },
    async barrier() {
      if (failure) throw failure
      await enqueue()
      if (failure) throw failure
    },
    get failed() { return failure },
  }
}
