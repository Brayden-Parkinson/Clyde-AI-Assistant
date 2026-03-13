function a(e,r=500){let n=e;return n=n.replace(/\r/g,""),n=n.replace(/\n{3,}/g,`

`),n=n.replace(/^[A-Z][A-Z _-]{2,}:/gm,t=>t.toLowerCase()),n=n.replace(/<\/?[a-zA-Z][a-zA-Z0-9_-]*\s*\/?>/g,""),n.length>r&&(n=n.slice(0,r)+"…"),n.trim()}function i(e){return a(e.replace(/\n/g," "),200)}function s(e){return a(e.replace(/\n/g," "),150)}function c(e){return e.replace(/[^a-zA-Z0-9 \-_/&]/g,"").slice(0,50).trim()}function o(e){return a(e,300)}function l(e){return a(e,2e3)}function u(e){return e.replace(/[\r\n]/g,"")}export{i as a,s as b,c,o as d,u as e,l as s};
