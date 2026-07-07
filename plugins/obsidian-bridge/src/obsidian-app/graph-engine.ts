// 纯函数图算法模块,零 Obsidian 依赖。
// 输入:无向图邻接表(由 vault-service.buildAdjacencies 构建并按 direction 选取)。

export type Adjacency = Map<string, Set<string>>;

export interface NeighborNode {
  path: string;
  depth: number;
  via: string; // 上一跳;起点 via 为自身
}

// N 跳邻居(BFS,逐层扩展),不含起点本身。
export function neighbors(adj: Adjacency, start: string, depth: number): NeighborNode[] {
  const out: NeighborNode[] = [];
  if (!adj.has(start) || depth <= 0) return out;
  const seen = new Set<string>([start]);
  let frontier: NeighborNode[] = [{ path: start, depth: 0, via: start }];
  for (let d = 1; d <= depth; d++) {
    const next: NeighborNode[] = [];
    for (const node of frontier) {
      for (const n of adj.get(node.path) ?? new Set<string>()) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push({ path: n, depth: d, via: node.path });
      }
    }
    out.push(...next);
    frontier = next;
    if (next.length === 0) break;
  }
  return out;
}

// 最短路径(BFS)。不可达或节点不存在返回 []。
export function shortestPath(adj: Adjacency, from: string, to: string): string[] {
  if (!adj.has(from) || !adj.has(to)) return [];
  if (from === to) return [from];
  const prev = new Map<string, string>();
  const seen = new Set<string>([from]);
  const queue: string[] = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const n of adj.get(cur) ?? new Set<string>()) {
      if (seen.has(n)) continue;
      seen.add(n);
      prev.set(n, cur);
      if (n === to) {
        const path = [to];
        let c: string = to;
        while (c !== from) {
          c = prev.get(c)!;
          path.unshift(c);
        }
        return path;
      }
      queue.push(n);
    }
  }
  return [];
}
