import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
import JSZip from "jszip";

// Exercise the actual browser batch function with HTTP/UI adapters and real ZIP encoding.
const file = ts.createSourceFile("workspace.tsx", readFileSync(new URL("../app/workspace.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let batchSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "startBatchDownload") batchSource = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(batchSource, "Batch implementation must exist");
const code = ts.transpileModule(batchSource, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

test("ZIP exports exactly the checked devices and includes their manifest", async () => {
  const requests = [];
  let blobUrl, logs = [], progress;
  const noop = () => {};
  const context = {
    batchRunning: false,
    downloadDevices: [{id: "AL-0001",selection_id:"1",segment_id:"1"}, {id: "AL-0002",selection_id:"2",segment_id:"2"}, {id: "AL-0001",selection_id:"3",segment_id:"3"}],
    selectedDeviceIds: ["1", "3"],
    start: "2026-10-01T00:00", end: "2026-10-01T23:59", admin: false,
    zoned: value => new Date(value + "Z").toISOString(),
    localTime: value => value,
    state: {me: {email: "member@example.test", name: "Test member"}},
    checkDeviceRange: () => ({status: "OK"}),
    setBatchModalOpen: noop, setBatchRunning: noop,
    setBatchProgress: value => {progress = value;},
    setBatchZipFilename: noop,
    setBatchBlobUrl: value => {blobUrl = value;},
    setBatchLogs: update => {logs = typeof update === "function" ? update(logs) : update;},
    JSZip, URL, URLSearchParams,
    fetch: async url => {
      const query = new URL(url, "http://localhost").searchParams;
      requests.push([query.get("aslung_id"),query.get("segment_id")]);
      return new Response("timestamp,value\n2026-10-01T12:00:00Z,42\n");
    },
    document: {createElement: () => ({click: noop})},
    toast: {error: message => assert.fail(message), warning: message => assert.fail(message), success: noop}
  };
  const execute = new Function("context", `const {${Object.keys(context).join(",")}} = context; ${code}; return startBatchDownload;`)(context);
  try {
    await execute("csv");
    assert.deepEqual(requests, [["AL-0001","1"], ["AL-0001","3"]]);
    assert.equal(progress, 100);
    assert.deepEqual(logs.map(log => log.status), ["success", "success"]);
    const archive = await JSZip.loadAsync(await (await fetch(blobUrl)).arrayBuffer());
    assert.deepEqual(Object.keys(archive.files).sort(), [
      "AL-0001_segment-1_2026-10-01_2026-10-01.csv",
      "AL-0001_segment-3_2026-10-01_2026-10-01.csv",
      "download_manifest.txt"
    ]);
    const manifest = await archive.file("download_manifest.txt").async("string");
    assert.ok(!manifest.includes("AL-0002"));
  } finally {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
});
