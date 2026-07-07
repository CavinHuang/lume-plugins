import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbors, shortestPath, structure, type Adjacency } from "../src/obsidian-app/graph-engine.ts";

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
});

test("structure top 限制 hub 数量", () => {
  const g: Adjacency = new Map();
  const add = (x: string, y: string) => { if (!g.has(x)) g.set(x, new Set()); if (!g.has(y)) g.set(y, new Set()); g.get(x)!.add(y); g.get(y)!.add(x); };
  add("hub", "x1"); add("hub", "x2"); add("hub", "x3");
  const rep = structure(g, 1);
  assert.equal(rep.hubs.length, 1);
  assert.equal(rep.hubs[0], "hub");
});
