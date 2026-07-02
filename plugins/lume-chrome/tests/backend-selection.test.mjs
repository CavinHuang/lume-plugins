import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseBackendForUrl,
  chooseDefaultBackend,
  isLocalBrowserUrl,
} from "../dist/client/backend-selection.js";

const iab = { id: "iab-1", type: "iab", openTabUrls: [] };
const chrome = { id: "chrome-1", type: "extension", openTabUrls: [] };

test("local URL classification rejects public and private-LAN targets", () => {
  for (const url of [
    "http://localhost:3000/",
    "https://localhost/",
    "http://127.0.0.9:8080/",
    "http://[::1]/",
  ]) assert.equal(isLocalBrowserUrl(url), true, url);

  for (const url of [
    "https://example.com/",
    "http://192.168.1.10/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
  ]) assert.equal(isLocalBrowserUrl(url), false, url);
});

test("default selection prefers IAB and falls back to Chrome", () => {
  assert.equal(chooseDefaultBackend([chrome, iab]).id, "iab-1");
  assert.equal(chooseDefaultBackend([chrome]).id, "chrome-1");
});

test("URL selection routes local targets to IAB and public targets to Chrome", () => {
  assert.equal(chooseBackendForUrl([chrome, iab], "http://localhost:3000/").id, "iab-1");
  assert.equal(chooseBackendForUrl([chrome, iab], "https://example.com/").id, "chrome-1");
});

test("an existing matching Chrome tab wins for public URLs", () => {
  const fallback = { ...chrome, id: "chrome-fallback" };
  const withTab = { ...chrome, openTabUrls: ["https://example.com/account#profile"] };

  assert.equal(
    chooseBackendForUrl([iab, fallback, withTab], "https://example.com/account").id,
    "chrome-1",
  );
});
