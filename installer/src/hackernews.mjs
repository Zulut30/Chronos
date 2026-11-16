export async function hackernewsSearch(a,{fetcher=fetch}={}){
 const q=String(a.query||'').trim();if(!q)throw new Error('Нужен поисковый запрос');
 const n=Math.min(30,Math.max(1,Number(a.limit)||10));
 const params=new URLSearchParams({query:q,tags:'story',hitsPerPage:String(n)});
 const res=await fetcher('https://hn.algolia.com/api/v1/'+(a.sort==='date'?'search_by_date':'search')+'?'+params,{signal:AbortSignal.timeout(20000)});
 if(!res.ok)throw new Error('Hacker News: HTTP '+res.status);
 const j=await res.json();return (j.hits||[]).map((h,i)=>`${i+1}. ${h.title||'(без названия)'}\n${h.url||'https://news.ycombinator.com/item?id='+h.objectID}\n${h.points||0} баллов · ${h.num_comments||0} комментариев · ${h.created_at||''}\nОбсуждение: https://news.ycombinator.com/item?id=${h.objectID}`).join('\n\n')||'Ничего не найдено';
}
