const {test, expect} = require('@playwright/test');

test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
  }
});

test('local provider completes a microphone meeting from capture through summary', async ({page, context}, testInfo) => {
  await context.grantPermissions(['microphone'], {origin: 'http://localhost:5173'});
  await page.addInitScript(() => {
    sessionStorage.setItem('trato:meeting-copilot-test.supabase.co:session', JSON.stringify({
      access_token: 'local-e2e-access-token',
      refresh_token: 'local-e2e-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: {id: 'local-e2e-user', email: 'e2e@example.test'}
    }));
  });

  await page.goto('/meeting-copilot.html');
  await expect(page.locator('.brand')).toContainText('trato');
  await page.locator('[data-experience="live"]').click();
  await page.locator('[data-context-field="client"]').selectOption('00000000-0000-4000-8000-000000000001');
  await page.locator('[data-context-field="project"]').selectOption('00000000-0000-4000-8000-000000000002');
  await expect(page.locator('.project-context')).toContainText('Acuerdo inicial');
  await expect(page.locator('.project-context')).toContainText('Texto disponible');
  await page.locator('[data-action="start"]').click();
  await expect(page.getByText('El cliente pregunta por el alcance y la fecha.')).toBeVisible({timeout: 15_000});

  await page.locator('[data-action="quick"][data-quick-key="what-reply"]').click();
  await expect(page.getByText('Podemos confirmar primero qué entrega y fecha quedaron acordadas.')).toBeVisible();
  await expect(page.getByText('¿Qué parte del alcance necesitan priorizar?')).toBeVisible();
  await expect(page.getByText('Audio local de prueba; contexto autorizado: Portal Web; documentos: 1.')).toBeVisible();

  await page.locator('[data-action="pause"]').click();
  await expect(page.locator('[data-action="pause"]')).toHaveText('Reanudar');
  await page.locator('[data-action="pause"]').click();
  await expect(page.locator('[data-action="pause"]')).toHaveText('Pausar');

  await page.screenshot({path: testInfo.outputPath('copilot-desktop.png'), fullPage: true});
  await page.locator('[data-action="end"]').click();
  await expect(page.getByText('Validar el proveedor Gemini autorizado.')).toBeVisible({timeout: 10_000});
  await expect(page.getByText('Este resultado fue generado por el proveedor de prueba local.')).toBeVisible();

  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator('.meeting-copilot-shell')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({path: testInfo.outputPath('copilot-mobile.png'), fullPage: true});
});