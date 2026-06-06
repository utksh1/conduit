#!/usr/bin/env node

const assert = require("assert");
const app = require("./server");

const { extractToolCalls } = app._internals;
const allowed = new Set(["glob", "grep", "read", "bash"]);

{
  const text = `<tool_call>
{"name":"file_search.msearch","arguments":{"queries":["list all files"]}}
</tool_call>`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { pattern: "**/*" });
}

{
  const text = `<file_search.msearch>{"queries":["*.js"],"path":"/tmp"}</file_search.msearch>`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), {
    pattern: "*.js",
    path: "/tmp",
  });
}

{
  const { toolCalls } = extractToolCalls(
    `<tool_call>{"name":"file_search.msearch","arguments":{"queries":["TODO"]}}</tool_call>`,
    new Set(["grep"])
  );
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "grep");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { pattern: "TODO" });
}

{
  const text = `{"queries":[""], "source_filter": ["file_library"], "intent": "nav"}`;
  const { cleanedText, toolCalls } = extractToolCalls(text, allowed);
  assert.strictEqual(cleanedText, "");
  assert.strictEqual(toolCalls.length, 1);
  assert.strictEqual(toolCalls[0].function.name, "glob");
  assert.deepStrictEqual(JSON.parse(toolCalls[0].function.arguments), { pattern: "**/*" });
}

console.log("file_search.msearch alias tests passed");
