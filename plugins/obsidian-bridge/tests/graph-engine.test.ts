import { test } from "node:test";
import assert from "node:assert/strict";
import { neighbors, shortestPath, type Adjacency } from "../src/obsidian-app/graph-engine.ts";

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
