import { test } from "node:test";
import assert from "node:assert/strict";
import { isWorkflowComment, FIREDRILL_MARKER } from "../src/github.ts";

test("comments by the token owner count (Alan posts as the user)", () => {
  assert.equal(isWorkflowComment("Summary of the PR"), true);
});

test("FireDrill's own marked comment is excluded", () => {
  assert.equal(isWorkflowComment(`note ${FIREDRILL_MARKER}`), false);
});

test("empty or missing bodies are ignored", () => {
  assert.equal(isWorkflowComment(""), false);
  assert.equal(isWorkflowComment(null), false);
});
