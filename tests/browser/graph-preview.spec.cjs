const {test,expect}=require('@playwright/test');

test('map lets the user inspect sources, follow connections and open the PDF',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const api=[];page.on('request',request=>{if(request.url().includes('/api/'))api.push(request.url());});
  await page.goto('/grafo.html');
  const root=page.locator('#graph-preview');
  await expect(root.getByRole('heading',{name:'Mapa del proyecto',exact:true})).toBeVisible();
  await expect(root.locator('[data-gd-node]')).toHaveCount(7);
  await expect(root.locator('.gd-inspector')).toContainText('¿Podrías agregar tres versiones verticales');
  await root.getByRole('button',{name:'Adenda y respaldo',exact:true}).click();
  await expect(root.locator('[data-gd-node="payment"]')).toHaveClass(/is-dim/);
  await expect(root.locator('.gd-inspector h2')).toHaveText('Propuesta de cambio');
  await root.getByRole('button',{name:'Ver documento fuente'}).click();
  await expect(page.locator('.gd-pdf-dialog')).toBeVisible();
  await expect(page.locator('.gd-pdf-dialog iframe')).toHaveAttribute('src','/data/pdfs/DOC-SP-001-propuesta.pdf');
  await page.getByRole('button',{name:'Cerrar documento',exact:true}).click();
  await expect(page.locator('.gd-pdf-dialog')).toHaveCount(0);
  await root.getByRole('button',{name:'Todo el proyecto',exact:true}).click();
  await root.locator('[data-gd-node="payment"]').click();
  await expect(root.locator('.gd-inspector')).toContainText('no al pedido adicional');
  await root.locator('.gd-connection').filter({hasText:'Presupuesto y alcance'}).click();
  await expect(root.locator('.gd-inspector h2')).toHaveText('Presupuesto y alcance');
  await page.screenshot({path:'.local/browser-tests/graph-design.png',fullPage:true});
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

test('map reports an example load error without inventing another graph',async({page})=>{
  await page.route('**/data/demo.json',route=>route.fulfill({status:503,json:{error:'unavailable'}}));
  await page.goto('/grafo.html');
  await expect(page.getByRole('heading',{name:'No se pudo abrir el mapa'})).toBeVisible();
  await expect(page.locator('[data-gd-node]')).toHaveCount(0);
});

test('refund example keeps the original payment and the pending refund separate',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const calls=[];page.on('request',request=>{if(request.url().includes('/api/'))calls.push(request.url());});
  await page.goto('/grafo.html');
  const root=page.locator('#graph-preview');
  await root.getByRole('button',{name:'Con una devolución',exact:true}).click();
  await expect(root).toHaveAttribute('data-gd-scenario','refund');
  await expect(root.locator('.gd-project-chip')).toContainText('Casa Oliva');
  await expect(root.locator('.gd-project-chip')).toContainText('Sesión de consultoría');
  await expect(root.locator('[data-gd-node="refund"]')).toHaveAttribute('aria-pressed','true');
  await expect(root.locator('.gd-inspector .gd-chip')).toHaveText('Pendiente');
  await expect(root.locator('[data-gd-node="payment"]')).toContainText('Pagado');
  await expect(root.locator('[data-gd-node="refund"]')).toContainText('USD 90.00');
  await expect(root.locator('[data-gd-edge="refund-payment"]')).toContainText('Sobre el pago original');
  await expect(root.locator('[data-gd-node="closure"]')).toContainText('Por preparar');
  await root.getByRole('button',{name:'Pago y devolución',exact:true}).click();
  await expect(root.locator('[data-gd-node="source"]')).toHaveClass(/is-dim/);
  await root.locator('[data-gd-node="payment"]').click();
  await expect(root.locator('.gd-inspector')).toContainText('sin borrar ni reemplazar');
  await root.locator('.gd-connection').filter({hasText:'USD 90.00'}).click();
  await expect(root.locator('.gd-inspector .gd-chip')).toHaveText('Pendiente');
  await page.screenshot({path:'.local/browser-tests/graph-refund-design.png',fullPage:true});
  await root.getByRole('button',{name:'Con un cambio',exact:true}).click();
  await expect(root.locator('.gd-project-chip')).toContainText('Luna Studio');
  await expect(root.locator('[data-gd-node="refund"]')).toHaveCount(0);
  await expect(root.locator('[data-gd-node="payment"]')).toContainText('USD 600.00');
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});

test('refund can open directly and keeps its cancellation source',async({page})=>{
  await page.goto('/grafo.html?scenario=refund');
  const root=page.locator('#graph-preview');
  await expect(root).toHaveAttribute('data-gd-scenario','refund');
  await root.getByRole('button',{name:'Motivo y condiciones',exact:true}).click();
  await expect(root.locator('.gd-inspector')).toContainText('necesito cancelar la sesión del 25');
  await root.locator('[data-gd-node="agreement"]').click();
  await expect(root.locator('.gd-inspector')).toContainText('más de 48 horas');
  await root.getByRole('button',{name:'Ver documento fuente'}).click();
  await expect(page.locator('.gd-pdf-dialog iframe')).toHaveAttribute('src','/data/pdfs/DOC-SP-003.pdf');
});
