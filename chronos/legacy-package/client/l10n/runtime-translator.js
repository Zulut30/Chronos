;(()=>{try{
const DICT=__OLY_RU__;const D=new Map(Object.entries(DICT.exact));const P=DICT.patterns.map(([s,r])=>[new RegExp(s),r]);
const SKIP='.chat-markdown,[data-user-message-bubble],pre,code,.font-mono,.composer-tiptap,[contenteditable="true"],textarea,input,select,.xterm,[data-thread-item] .truncate:not(.text-secondary-label),[data-slot="project-monogram"]';
const A=['aria-label','placeholder','title'];
function tr(s,depth){const t=s.trim();if(t.length<2||t.length>500)return null;let v=D.get(t);
if(v===undefined&&(depth|0)<2){for(const[r,f]of P){const m=r.exec(t);if(m){v=f.replace(/\$(\d)/g,(_,i)=>{const g=m[+i]??'';const x=tr(g,(depth|0)+1);return x===null?g:x.trim()});break}}}
if(v===undefined||v===t)return null;return s.replace(t,v)}
function text(n){const p=n.parentElement;if(!p||p.closest(SKIP))return;const v=tr(n.nodeValue);if(v!==null&&v!==n.nodeValue)n.nodeValue=v}
function attrs(e){for(const a of A){const x=e.getAttribute(a);if(x){const v=tr(x);if(v!==null&&v!==x)e.setAttribute(a,v)}}}
function walk(r){if(r.nodeType===3){text(r);return}if(r.nodeType!==1||r.closest(SKIP))return;attrs(r);const w=document.createTreeWalker(r,5,{acceptNode:n=>n.nodeType===1&&n.matches(SKIP)?2:1});let n;while(n=w.nextNode())n.nodeType===3?text(n):attrs(n)}
const mo=new MutationObserver(ms=>{for(const m of ms){if(m.type==='characterData')text(m.target);else if(m.type==='attributes'){if(!m.target.closest(SKIP))attrs(m.target)}else for(const n of m.addedNodes)walk(n)}});
const start=()=>{walk(document.body);mo.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:A})};
document.body?start():addEventListener('DOMContentLoaded',start);
}catch(e){console.warn('olympus ru runtime',e)}})();
