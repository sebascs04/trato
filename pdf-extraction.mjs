import { spawn } from 'node:child_process';

export function extractEmailFields(text) {
  const normalized = text.replace(/\r/g, '').trim();
  const lines = normalized.split('\n').map(line => line.trim());
  const subject = lines.find(line => /^(?:asunto|subject)\s*:/i.test(line))?.replace(/^[^:]+:\s*/, '').slice(0,160) || '';
  const senderLine = lines.find(line => /^(?:de|from)\s*:/i.test(line));
  const sender = senderLine?.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const dateLine = lines.find(line => /^(?:fecha|date|enviado|sent)\s*:/i.test(line)) || '';
  let emailDate = dateLine.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1] || '';
  if (!emailDate) {
    const match = dateLine.match(/\b(\d{1,2})\s+(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:tiembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\.?\s+(?:de\s+)?(20\d{2})\b/i);
    if (match) {
      const month = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'].indexOf(match[2].toLowerCase().slice(0,3)) + 1;
      emailDate = `${match[3]}-${String(month).padStart(2,'0')}-${match[1].padStart(2,'0')}`;
    }
  }
  if (emailDate && (Number.isNaN(Date.parse(emailDate)) || new Date(emailDate).toISOString().slice(0,10) !== emailDate)) emailDate='';
  // Preserve the complete readable text for review; do not infer a request or acceptance.
  return {subject, sender, emailDate, message:normalized.slice(0,6000), extractedText:normalized, truncated:normalized.length>6000};
}

export function extractPdfText(bytes) {
  return new Promise((resolve,reject) => {
    const process = spawn('pdftotext',['-layout','-','-'],{stdio:['pipe','pipe','pipe']});
    const chunks=[]; let size=0; let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{process.kill();finish(new Error('PDF_TIMEOUT'));},12000);
    process.on('error',()=>finish(new Error('PDF_UNAVAILABLE')));
    process.stdin.on('error',()=>{});
    process.stderr.resume();
    process.stdout.on('data',chunk=>{size+=chunk.length;if(size>250000){process.kill();finish(new Error('PDF_TOO_LONG'));}else chunks.push(chunk);});
    process.on('close',code=>{
      if(code!==0){finish(new Error('PDF_UNREADABLE'));return;}
      const text=Buffer.concat(chunks).toString('utf8').trim();
      if(!text){finish(new Error('PDF_NO_TEXT'));return;}
      finish(null,text);
    });
    process.stdin.end(bytes);
  });
}
