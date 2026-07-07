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

export interface StructureReport {
  hubs: string[];
  orphans: string[];
  bridges: { from: string; to: string }[];
}

// 结构分析:hub(度数 top-N 降序)、orphans(零度节点)、bridges(Tarjan 桥边)。
export function structure(adj: Adjacency, top = 10): StructureReport {
  // hub: 度数 top-N(降序)
  const hubs = [...adj.entries()]
    .filter(([, ns]) => ns.size > 0)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, top)
    .map(([n]) => n);
  // orphans: 零度
  const orphans = [...adj.entries()].filter(([, ns]) => ns.size === 0).map(([n]) => n);
  // bridges: Tarjan 桥边算法(递归)
  const bridges = findBridges(adj);
  return { hubs, orphans, bridges };
}

// Tarjan 桥边:无向图中删除后使连通分量数增加的边。
// 桥条件:树边 (u,v) 满足 low[v] > disc[u](v 子树无法绕过 u-v 回到 u 或更早)。
function findBridges(adj: Adjacency): { from: string; to: string }[] {
  const result: { from: string; to: string }[] = [];
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const visited = new Set<string>();
  let time = 0;

  function dfs(u: string, parent: string | null) {
    visited.add(u);
    disc.set(u, time);
    low.set(u, time);
    time++;
    for (const v of adj.get(u) ?? new Set<string>()) {
      if (!visited.has(v)) {
        dfs(v, u);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        if (low.get(v)! > disc.get(u)!) {
          result.push(u < v ? { from: u, to: v } : { from: v, to: u });
        }
      } else if (v !== parent) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  for (const node of adj.keys()) {
    if (!visited.has(node)) dfs(node, null);
  }
  return result;
}

export interface SimilarNode {
  path: string;
  score: number; // 0..1 Jaccard
}

// 共邻居 Jaccard 相似度:|N(x)∩N(y)| / |N(x)∪N(y)|,不含 x/y 自身。
// 排除起点自身与零分节点;按 score 降序,截断至 limit(默认 10)。
export function similar(adj: Adjacency, start: string, limit = 10): SimilarNode[] {
  if (!adj.has(start)) return [];
  const startN = adj.get(start) ?? new Set<string>();
  const out: SimilarNode[] = [];
  for (const [node, neighbors] of adj) {
    if (node === start) continue;
    let inter = 0;
    for (const n of startN) if (neighbors.has(n)) inter++;
    const union = startN.size + neighbors.size - inter;
    const score = union === 0 ? 0 : inter / union;
    if (score > 0) out.push({ path: node, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
