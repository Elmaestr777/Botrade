// Brace checker ignoring strings and comments
const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node check_braces.js <file>'); process.exit(2); }
const s = fs.readFileSync(path, 'utf8');
let inS=false,inD=false,inT=false,inLC=false,inBC=false,esc=false;
const stack=[];
let line=1,col=0;
for(let i=0;i<s.length;i++){
  const ch=s[i];
  if(ch==='\n'){ line++; col=0; inLC=false; continue; }
  col++;
  if(inLC){ continue; }
  if(inBC){ if(ch==='*' && s[i+1]=== '/') { inBC=false; i++; col++; } continue; }
  if(inS){ if(!esc && ch==="'"){ inS=false; } esc = (ch==='\\' && !esc); continue; }
  if(inD){ if(!esc && ch==='"'){ inD=false; } esc = (ch==='\\' && !esc); continue; }
  if(inT){ if(!esc && ch==='`'){ inT=false; } esc = (ch==='\\' && !esc); continue; }
  if(ch==='/'){
    if(s[i+1]==='/'){ inLC=true; i++; col++; continue; }
    if(s[i+1]==='*'){ inBC=true; i++; col++; continue; }
  }
  if(ch==="'"){ inS=true; esc=false; continue; }
  if(ch==='"'){ inD=true; esc=false; continue; }
  if(ch==='`'){ inT=true; esc=false; continue; }
  if(ch==='{'){
    stack.push({line,col,i});
  } else if(ch==='}'){
    if(stack.length) {stack.pop();} else {console.log('Extra closing at', line, col);}
  }
}
if(stack.length){
  const o=stack[stack.length-1];
  console.log('Unmatched opening { at line', o.line, 'col', o.col);
  const lines=s.split(/\r?\n/);
  const start=Math.max(1,o.line-3), end=Math.min(lines.length,o.line+3);
  for(let j=start;j<=end;j++){
    console.log(String(j).padStart(4,' ')+': '+lines[j-1]);
  }
  process.exit(1);
} else {
  console.log('Braces balanced (ignoring strings/comments)');
}
