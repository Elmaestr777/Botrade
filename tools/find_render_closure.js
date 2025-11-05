const fs = require('fs');
const p = process.argv[2];
const s = fs.readFileSync(p, 'utf8');
function strip(s){ let out=''; let inS=false,inD=false,inT=false,inLC=false,inBC=false,esc=false; for(let i=0;i<s.length;i++){ const ch=s[i]; const nxt=s[i+1]; if(ch==='\n'){ out+=ch; inLC=false; continue; } if(inLC){ continue; } if(inBC){ if(ch==='*' && nxt=== '/') { inBC=false; i++; } continue; } if(inS){ if(!esc && ch==="'") {inS=false;} esc=(ch==='\\' && !esc); continue; } if(inD){ if(!esc && ch==='"') {inD=false;} esc=(ch==='\\' && !esc); continue; } if(inT){ if(!esc && ch==='`') {inT=false;} esc=(ch==='\\' && !esc); continue; } if(ch==='/' && nxt==='/' ){ inLC=true; i++; continue; } if(ch==='/' && nxt==='*'){ inBC=true; i++; continue; } if(ch==="'"){ inS=true; esc=false; continue; } if(ch==='"'){ inD=true; esc=false; continue; } if(ch==='`'){ inT=true; esc=false; continue; } out+=ch; } return out; }
const t=strip(s);
const start=t.indexOf('function renderLBC(){');
if(start<0){ console.log('not found'); process.exit(1); }
let level=0; let i=start; let line=1, col=0; for(let k=0;k<i;k++){ if(t[k]=='\n') {line++;} }
for(i=start; i<t.length; i++){
  const ch=t[i]; if(ch==='\n'){ line++; col=0; continue; } col++;
  if(ch==='{'){ level++; }
  else if(ch==='}'){ level--; if(level===0){ console.log('renderLBC closes at line', line, 'col', col); process.exit(0); } }
}
console.log('No closing brace for renderLBC'); process.exit(1);
