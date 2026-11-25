import test from "node:test";
import assert from "node:assert/strict";
import {decodeFiles} from "./assets.mjs";
const large = Buffer.alloc(15 * 1024**2,255);
test("decoded byte and file count boundaries include index.html",()=>{
  const exact = {"index.html":"a".repeat(1024**2),"assets/picture.png":{encoding:"base64",data:large.toString("base64")}};
  assert.equal(decodeFiles(exact).decoded[1][1].length,large.length);
  assert.throws(()=>decodeFiles({...exact,"extra":"x"}),/16 МБ/);
  assert.throws(()=>decodeFiles({"index.html":"a".repeat(large.length+1)}),/15 МБ/);
  const many = Object.fromEntries(Array.from({length:254},(_,i)=>[String(i),""]));
  assert.equal(decodeFiles({"index.html":"",...many}).decoded.length,255);
  assert.throws(()=>decodeFiles({"index.html":"",...many,another:""}),/255/);
  assert.throws(()=>decodeFiles({"index.html":"ok",font:{encoding:"base64",data:"@@"}}),/base64/);
});
