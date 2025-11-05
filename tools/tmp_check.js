const fs = require('fs');
const path = process.argv[2];
let s = fs.readFileSync(path, 'utf8');
const start = parseInt(process.argv[3]||'1');
const end = parseInt(process.argv[4]||'0');
if(end>0){
  const lines = s.split(/\r?\n/);
  s = lines.slice(start-1, end).join('\n');
}
let inS=false,inD=false,inT=false,inLC=false,inBC=false,esc=false;
let braces=0, parens=0, brackets=0, backticks=0;
const stack=[]; // entries: {ch, i, line, col}
let line=1,col=0;
for(let i=0;i<s.length;i++){
  const ch = s[i], n = s[i+1];
  if(ch==='\n'){ line++; col=0; inLC=false; continue; }
  col++;
  if(inLC){ continue; }
  if(inBC){ if(ch==='*' && n=== '/') { inBC=false; i++; col++; } continue; }
  if(inS){ if(!esc && ch==="'") {inS=false;} esc=(ch==='\\' && !esc); continue; }
  if(inD){ if(!esc && ch==='"') {inD=false;} esc=(ch==='\\' && !esc); continue; }
  if(inT){ if(!esc && ch==='`') { inT=false; backticks++; } esc=(ch==='\\' && !esc); continue; }
  if(ch==='/' && n==='/' ){ inLC=true; i++; col++; continue; }
  if(ch==='/' && n==='*'){ inBC=true; i++; col++; continue; }
  if(ch==="'"){ inS=true; esc=false; continue; }
  if(ch==='"'){ inD=true; esc=false; continue; }
  if(ch==='`'){ inT=true; esc=false; continue; }
  if(ch==='{'){ braces++; stack.push({ch:'{', i, line, col}); }
  else if(ch==='}'){ braces--; stack.pop(); }
  else if(ch==='('){ parens++; stack.push({ch:'(', i, line, col}); }
  else if(ch===')'){ parens--; stack.pop(); }
  else if(ch==='['){ brackets++; stack.push({ch:'[', i, line, col}); }
  else if(ch===']'){ brackets--; stack.pop(); }
}
console.log(JSON.stringify({ braces, parens, brackets, backticks, stack }));
