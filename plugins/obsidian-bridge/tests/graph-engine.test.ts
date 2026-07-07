import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbors, shortestPath, structure, similar, type Adjacency } from "../src/obsidian-app/graph-engine.ts";

// 图: a-b-c-d(链), b-e(分支)
function chainGraph(): Adjacency {
  const m: Adjacency = new Map();
  const add = (x: string, y: string) => {
    if (!m.has(x)) m.set(x, new Set());
    if (!m.has(y)) m.set(y, new Set());
    m.get(x)!.add(y);
    m.get(y)!.add(x);
  };
  add("a", "b"); add("b", "c"); add("c", "d"); add("b", "e");
  // 孤立节点
  m.set("lonely", new Set());
  return m;
}

test("neighbors depth=1 返回直接邻居", () => {
  const ns = neighbors(chainGraph(), "b", 1).map((n) => n.path).sort();
  assert.deepEqual(ns, ["a", "c", "e"]);
});

test("neighbors depth=2 不重复、含 2 跳", () => {
  const ns = neighbors(chainGraph(), "a", 2).map((n) => n.path).sort();
  assert.deepEqual(ns, ["b", "c", "e"]); // a→b(1) →a,c,e(2,但 a 已见)
});

test("neighbors 返回的 depth/via 反映 BFS 层级与上一跳", () => {
  // 图: a-b-c-d 链 + b-e 分支
  const ns = neighbors(chainGraph(), "a", 2);
  const byPath = new Map(ns.map((n) => [n.path, n]));
  // 1 跳:b 经由 a
  assert.equal(byPath.get("b")!.depth, 1);
  assert.equal(byPath.get("b")!.via, "a");
  // 2 跳:c、e 均经由 b
  assert.equal(byPath.get("c")!.depth, 2);
  assert.equal(byPath.get("c")!.via, "b");
  assert.equal(byPath.get("e")!.depth, 2);
  assert.equal(byPath.get("e")!.via, "b");
  // 起点本身不应出现在结果里
  assert.ok(!byPath.has("a"));
});

test("neighbors 在含环图上必终止且不重复(seen-set 环安全)", () => {
  // 三角环 r-u-v-r:每个节点都能绕环回到自己,若无 seen-set 会无限循环
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => {
    if (!g.has(x)) g.set(x, new Set());
    if (!g.has(y)) g.set(y, new Set());
    g.get(x)!.add(y);
    g.get(y)!.add(x);
  };
  add("r", "u"); add("u", "v"); add("v", "r");
  // depth=3 覆盖全图:从 r 出发应在访问完 u、v 后终止,不绕环重复
  const ns = neighbors(g, "r", 3);
  const paths = ns.map((n) => n.path).sort();
  assert.deepEqual(paths, ["u", "v"]); // 不含起点 r,不重复
  // 环上两邻居都在第 1 跳被收录(经由 r),无更深层级(都被 seen 阻断)
  for (const n of ns) {
    assert.equal(n.depth, 1);
    assert.equal(n.via, "r");
  }
});

test("neighbors 起点不存在返回空", () => {
  assert.equal(neighbors(chainGraph(), "missing", 2).length, 0);
});

test("shortestPath 找到最短路径", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "d"), ["a", "b", "c", "d"]);
});

test("shortestPath 起终点相同返回单元素", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "a"), ["a"]);
});

test("shortestPath 不可达返回空数组", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "lonely"), []);
});

test("shortestPath 节点不存在返回空", () => {
  assert.deepEqual(shortestPath(chainGraph(), "a", "ghost"), []);
});

test("structure 识别 hub / orphans / bridges", () => {
  // a-b, b-c, c-d, 孤立 lonely;桥为 c-d(删后 d 断开)
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => {
    if (!g.has(x)) g.set(x, new Set());
    if (!g.has(y)) g.set(y, new Set());
    g.get(x)!.add(y); g.get(y)!.add(x);
  };
  add("a", "b"); add("b", "c"); add("c", "d");
  g.set("lonely", new Set());
  const rep = structure(g, 10);
  // b、c 度数最高(各 2),排在前
  assert.ok(rep.hubs.includes("b"));
  assert.ok(rep.hubs.includes("c"));
  assert.ok(rep.orphans.includes("lonely"));
  // c-d 是桥
  assert.ok(rep.bridges.some((br) => (br.from === "c" && br.to === "d") || (br.from === "d" && br.to === "c")));
  // 度数高的节点排在前面(b 度 2,a 度 1)
  assert.ok(rep.hubs.indexOf("b") < rep.hubs.indexOf("a"), "度数高的节点排在前面");
});

test("structure 环图中没有桥边(锁定 > 而非 >=)", () => {
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => {
    if (!g.has(x)) g.set(x, new Set());
    if (!g.has(y)) g.set(y, new Set());
    g.get(x)!.add(y); g.get(y)!.add(x);
  };
  add("r", "u"); add("u", "v"); add("v", "r");
  const rep = structure(g, 10);
  assert.equal(rep.bridges.length, 0);
});

test("structure top 限制 hub 数量", () => {
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("hub", "x1"); add("hub", "x2"); add("hub", "x3");
  const rep = structure(g, 1);
  assert.equal(rep.hubs.length, 1);
  assert.equal(rep.hubs[0], "hub");
});

// --- similar(Jaccard 共邻居)---

test("similar 按共邻居 Jaccard 排序", () => {
  // x 与 y 都连到 shared1/shared2 → 共 2 邻居(高相似);x 与 z 仅共 shared1 → 共 1 邻居(低相似)
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("x", "shared1"); add("x", "shared2");
  add("y", "shared1"); add("y", "shared2");
  add("z", "shared1");
  const sim = similar(g, "x", 10);
  const y = sim.find((s) => s.path === "y")!;
  const z = sim.find((s) => s.path === "z")!;
  assert.ok(y.score > z.score, "y(共2邻居)相似度应高于 z(共1邻居)");
  assert.ok(y.score > 0 && y.score <= 1, "score 应在 (0,1]");
  assert.ok(z.score > 0 && z.score <= 1, "score 应在 (0,1]");
  // 精确值:N(x)={shared1,shared2}, N(y)={shared1,shared2} → 2/2 = 1
  assert.equal(y.score, 1);
  // N(z)={shared1} → inter=1, union=2 → 1/2
  assert.equal(z.score, 0.5);
});

test("similar 起点不存在返回空", () => {
  assert.equal(similar(new Map(), "missing").length, 0);
});

test("similar 排除起点与零分节点,按分数降序", () => {
  // x 邻居 {a, b};y 邻居 {a, b}(共 2,Jaccard=1);w 邻居 {a}(共 1,Jaccard=1/3);
  // unrelated 邻居 {q}(共 0 → 不应出现);start x 自身不应出现
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("x", "a"); add("x", "b");
  add("y", "a"); add("y", "b");
  add("w", "a");
  add("unrelated", "q");
  const sim = similar(g, "x", 10);
  // 起点自身被排除
  assert.ok(!sim.some((s) => s.path === "x"), "起点自身不应出现");
  // 零分节点被排除
  assert.ok(!sim.some((s) => s.path === "unrelated"), "零分节点不应出现");
  assert.ok(!sim.some((s) => s.path === "q"), "零分节点不应出现");
  // 降序
  for (let i = 1; i < sim.length; i++) {
    assert.ok(sim[i - 1].score >= sim[i].score, "应按 score 降序");
  }
  // y(jaccard=1) 应排在 w(jaccard=1/3) 前
  assert.equal(sim[0].path, "y");
  // y Jaccard 精确值:|{a,b}∩{a,b}| / |{a,b}∪{a,b}| = 2/2 = 1
  assert.equal(sim[0].score, 1);
});

test("similar limit 截断结果", () => {
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  // x 与 n1..n5 各共享一个不同的邻居 → 全部 score 相同(均为 1/3),limit=2 应只回 2 个
  add("x", "s1"); add("x", "s2");
  add("n1", "s1"); add("n2", "s1"); add("n3", "s1"); add("n4", "s1"); add("n5", "s1");
  const sim = similar(g, "x", 2);
  assert.equal(sim.length, 2);
});

test("similar 默认 limit=10", () => {
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("x", "shared");
  for (let i = 1; i <= 15; i++) add(`n${i}`, "shared");
  const sim = similar(g, "x");
  assert.equal(sim.length, 10, "默认 limit=10");
});
