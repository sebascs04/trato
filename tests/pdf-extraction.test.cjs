const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
test('recognizes explicit email headers and Spanish date without inventing missing fields',async()=>{
  const {extractEmailFields}=await import('../pdf-extraction.mjs');
  const result=extractEmailFields('Asunto: Nuevas versiones\nDe: Ana <ana@example.com>\nFecha: 24 de octubre de 2026\n\nNecesitamos subtítulos.');
  assert.equal(result.subject,'Nuevas versiones');
  assert.equal(result.sender,'ana@example.com');
  assert.equal(result.emailDate,'2026-10-24');
  assert.match(result.message,/Necesitamos subtítulos/);
  const missing=extractEmailFields('Documento de condiciones sin cabecera de correo');
  assert.equal(missing.subject,'');assert.equal(missing.sender,'');assert.equal(missing.emailDate,'');
  assert.equal(extractEmailFields('Fecha: 2026-02-31').emailDate,'');
});
test('reads actual PDF bytes with local pdftotext',async t=>{
  if(spawnSync('pdftotext',['-v']).error){t.skip('pdftotext is not installed');return;}
  const {extractPdfText}=await import('../pdf-extraction.mjs');
  const bytes=readFileSync(new URL('../data/pdfs/DOC-SP-001-solicitud.pdf',`file://${__filename}`));
  const text=await extractPdfText(bytes);
  assert.match(text,/TRATO/);assert.match(text,/Correo de solicitud/);
  await assert.rejects(extractPdfText(Buffer.from('not a PDF')),/PDF_UNREADABLE/);
});
