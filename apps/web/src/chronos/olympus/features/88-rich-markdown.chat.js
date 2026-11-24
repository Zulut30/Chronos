;/* oly rich text: agents may colour and format chat text with a safe subset of inline HTML.
   <span style="color:red;background:yellow;font-weight:bold;font-style:italic;text-decoration:underline">,
   <font color="red">, <mark>, <u>. Only these style properties and plain colour values survive; named colours map to
   theme-tuned variables (--oly-c-*, defined by the main-bundle module) with the plain name as fallback for copies. */
var __olyRichNamed=new Set(`red orange yellow green teal cyan blue purple pink gray grey gold brown`.split(` `));
function __olyRichColor(v,bg){v=String(v).trim().toLowerCase();if(v===`grey`)v=`gray`;
 if(__olyRichNamed.has(v))return`var(--oly-${bg?`bg`:`c`}-${v},${v})`;
 if(/^#[0-9a-f]{3,8}$/.test(v)||/^(?:rgb|hsl)a?\([\d\s.,%/deg+-]{1,60}\)$/.test(v)||/^[a-z]{3,20}$/.test(v))return v;return null}
function __olyRichStyle(s){const out=[];for(const part of String(s).split(`;`)){const i=part.indexOf(`:`);if(i<1)continue;
 const k=part.slice(0,i).trim().toLowerCase(),v=part.slice(i+1).trim().replace(/\s*!important$/i,``);let w=null;
 if(k===`color`)w=__olyRichColor(v,!1);else if(k===`background`||k===`background-color`){w=__olyRichColor(v,!0);if(w)out.push(`border-radius:3px`,`padding:0 .15em`)}
 else if(k===`font-weight`)w=/^(?:bold|bolder|normal|[1-9]00)$/i.test(v)?v:null;else if(k===`font-style`)w=/^(?:italic|normal)$/i.test(v)?v:null;
 else if(k===`text-decoration`||k===`text-decoration-line`)w=/^(?:underline|line-through|overline|none)(?:\s+(?:underline|line-through|overline))*$/i.test(v)?v:null;
 if(w)out.push(`${k===`background`?`background-color`:k}:${w}`)}return out.join(`;`)}
function __olyRichPre(){return t=>{const w=e=>{if(e.type===`element`&&e.properties){const p=e.properties;
 if(e.tagName===`font`){e.tagName=`span`;const c=p.color;delete p.color;delete p.face;delete p.size;if(c!=null)p.style=`color:${c};`+(p.style??``)}
 if(p.style!=null){const v=__olyRichStyle(p.style);delete p.style;if(v)p.dataOlyStyle=v}}e.children?.forEach(w)};w(t)}}
function __olyRichPost(){return t=>{const w=e=>{if(e.type===`element`&&e.properties&&e.properties.dataOlyStyle!=null){const p=e.properties,v=__olyRichStyle(String(p.dataOlyStyle).replace(/var\(--oly-(?:bg|c)-[a-z]+,([a-z]+)\)/g,`$1`));delete p.dataOlyStyle;if(v){p.style=v;p.dataOlyRich=``}}e.children?.forEach(w)};w(t)}}
