import test from 'node:test';
import assert from 'node:assert/strict';
import {compareCMSExport} from './compare-cms-export.mjs';
test('line endings, build comments and raw literal spelling are not business differences',()=>{
    const r=compareCMSExport('// source.js\r\nconst x = 0xA;\r\nexport {x};\r\n//# sourceMappingURL=x.map\r\n',
        '// local/source.js\nconst x = 10;\nexport {x};\n');
    assert.equal(r.executableASTEqual,true);assert.equal(r.live.crlfCount,4);
    assert.equal(r.equalAfterLFAndWholeLineCommentRemoval,false,'literal spelling still differs after comments only');
});
test('grant-check removal and string changes are detected without exposing literals',()=>{
    const a='export function auth() { return "SECRET_VALUE"; }';
    const b='export function auth() { check(); return "OTHER_SECRET"; }';
    const r=compareCMSExport(a,b);assert.equal(r.executableASTEqual,false);assert.ok(r.differingASTPaths.length);
    assert.doesNotMatch(JSON.stringify(r),/SECRET_VALUE|OTHER_SECRET/);
});
test('regex semantics and strict directives are preserved in comparison',()=>{
    assert.equal(compareCMSExport('const r=/a+/g;','const r=/b+/g;').executableASTEqual,false);
    assert.equal(compareCMSExport('function a(){"use strict";return 1;}','function a(){return 1;}').executableASTEqual,false);
});
test('tagged-template raw spelling is executable behavior and must not be discarded',()=>{
    assert.equal(compareCMSExport('const x=String.raw`\\n`;','const x=String.raw`\n`;').executableASTEqual,false);
});
test('untrusted export is parsed, never executed; invalid syntax fails closed',()=>{
    delete globalThis.CMS_EXPORT_WAS_EXECUTED;
    const source='globalThis.CMS_EXPORT_WAS_EXECUTED=true; export const x=1n;';
    assert.equal(compareCMSExport(source,source).executableASTEqual,true);
    assert.equal(globalThis.CMS_EXPORT_WAS_EXECUTED,undefined);
    assert.throws(()=>compareCMSExport('export {',source));
});
