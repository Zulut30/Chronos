;(()=>{try{
// Russian fixes the dictionary translator cannot do: plural of "N changed files" (count, noun and the
// one-letter "s" are separate text nodes) and Waiting/Running in monospace rows the translator skips.
const FORMS=['изменённый файл','изменённых файла','изменённых файлов'];
const form=n=>{n=Math.abs(n)%100;const d=n%10;return n>10&&n<20?2:d===1?0:d>=2&&d<=4?1:2};
const NOUN=/^(\s*)(changed file|изменённый файл|изменённых файла|изменённых файлов)\s*$/;
const WORDS={Waiting:'Ожидание',Running:'Выполняется'};
const USER='.chat-markdown,[data-user-message-bubble],pre,code,.composer-tiptap,[contenteditable="true"],textarea,input,.xterm';
const HDR='[data-changed-files-header]';
function set(n,v){if(n.nodeValue!==v)n.nodeValue=v}
function files(el){
 const t=[...el.childNodes].filter(n=>n.nodeType===3);const i=t.findIndex(n=>NOUN.test(n.nodeValue));if(i<1)return;
 const num=parseInt(t.slice(0,i).map(n=>n.nodeValue).join('').replace(/\D/g,''),10);if(!Number.isFinite(num))return;
 set(t[i],t[i].nodeValue.replace(NOUN,(_,sp)=>sp+FORMS[form(num)]));
 for(const n of t.slice(i+1))if(/^s?$/.test(n.nodeValue))set(n,'');
}
// user/agent content (chat, code, editors, terminal): O(1) through 05-oly-core, closest() without it
let user=n=>{const p=n.nodeType===1?n:n.parentElement;return!!(p&&p.closest(USER))};
function word(n){const w=WORDS[n.nodeValue];if(w&&n.parentElement&&!user(n))set(n,w)}
function header(h){const seen=new Set();const tw=document.createTreeWalker(h,4);let n;while(n=tw.nextNode()){const p=n.parentElement;if(p&&!seen.has(p)){seen.add(p);files(p)}}}
function visit(r){
 if(r.nodeType===3){const p=r.parentElement;if(!p)return;const h=p.closest(HDR);if(h)files(p);else word(r);return}
 if(r.nodeType!==1||user(r))return;
 const h=r.closest(HDR);if(h){header(h);return}
 for(const x of r.querySelectorAll(HDR))header(x);
 // Waiting/Running: only text nodes with exactly these values; chat/code/editor subtrees are rejected whole
 const tw=document.createTreeWalker(r,5,{acceptNode:n=>n.nodeType===1?(n.matches(USER)?2:3):(WORDS[n.nodeValue]?1:3)});let n;while(n=tw.nextNode())word(n);
}
let queue=new Set(),raf=0;
const flush=()=>{raf=0;const q=queue;queue=new Set();for(const r of q)if(r.isConnected)visit(r)};
// filter before queueing: content subtrees are dropped, character data only matters for statuses and the header
const mo=new MutationObserver(ms=>{for(const m of ms){const t=m.target;
 if(m.type==='characterData'){const v=t.nodeValue;if(WORDS[v]||(v.length<40&&/^\s*\d*\s*$|^s?$|changed file|изменённ/.test(v))){if(!user(t))queue.add(t)}}
 else if(m.addedNodes.length&&!user(t))for(const n of m.addedNodes)queue.add(n)}
 if(queue.size&&!raf)raf=requestAnimationFrame(flush)});
const start=()=>{const core=globalThis.__olyCore;if(core&&typeof core.isContentSubtree==='function')user=core.isContentSubtree;
 visit(document.body);mo.observe(document.body,{subtree:true,childList:true,characterData:true})};
document.body?start():addEventListener('DOMContentLoaded',start);
globalThis.__olyRuFixes={form,files};
}catch(e){console.warn('oly ru-fixes',e)}})();
