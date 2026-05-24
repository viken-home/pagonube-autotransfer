import { chromium } from 'playwright';
import dotenv from 'dotenv';
import { appendFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dir   = dirname(fileURLToPath(import.meta.url));
const SESSION = join(__dir, 'session.json');
const LOG     = join(__dir, 'transfer.log');
const DEBUG   = process.argv.includes('--debug');
const SETUP   = process.argv.includes('--setup');
const CI      = process.env.GITHUB_ACTIONS === 'true';

const EMAIL      = process.env.TN_EMAIL;
const PASSWORD   = process.env.TN_PASSWORD;
const MIN_AMOUNT = parseFloat(process.env.MIN_AMOUNT ?? '0');

const PAGONUBE_URL = 'https://vikenhome3.mitiendanube.com/admin/nuvempago/';

async function saveSession(context) {
  const cookies = await context.cookies();
  writeFileSync(SESSION, JSON.stringify({ cookies, origins: [] }));
}

function log(msg) {
  const line = `[${new Date().toLocaleString('es-AR')}] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG, line + '\n'); } catch {}
}

async function screenshot(page, name) {
  if (!DEBUG) return;
  await page.screenshot({ path: join(__dir, `${name}.png`), fullPage: true }).catch(() => {});
}

async function login(page, context) {
  log('Sin sesión activa — iniciando login...');
  await page.goto('https://www.tiendanube.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const emailLoginBtn = page.locator('a, button').filter({ hasText: /ingresar con e-mail|continuar con e-mail/i }).first();
  if (await emailLoginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await emailLoginBtn.click();
    await page.waitForTimeout(2000);
  }

  await page.locator('#user-mail').fill(EMAIL, { force: true });
  await page.locator('#user-password, input[type="password"]').first().fill(PASSWORD, { force: true });
  await page.locator('button').filter({ hasText: /^ingresar$|^entrar$/i }).first().click();

  await page.waitForURL(/admin/, { timeout: 25000 });
  await saveSession(context);
  log('Login exitoso ✓');
}

async function setupSession() {
  console.log('\n=== MODO SETUP ===');
  console.log('Se abrirá el browser. Hacé login manualmente:');
  console.log('  1. Ingresá email y contraseña');
  console.log('  2. Completá el código 2FA');
  console.log('  3. Marcá "Continuar desconectado 30 días"');
  console.log('  4. Esperá a que cargue el admin de TiendaNube');
  console.log('El script guarda la sesión automáticamente cuando llegás al admin.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('https://www.tiendanube.com/login', { waitUntil: 'domcontentloaded' });
  console.log('Esperando que completes el login...');
  await page.waitForURL(/mitiendanube\.com\/admin/, { timeout: 120000 });

  await saveSession(context);
  console.log('\n✓ Sesión guardada. El script automático funcionará por los próximos 30 días.\n');
  await browser.close();
}

function getPaymentsFrame(page) {
  return page.frames().find(f => f.url().includes('services-financials')) || null;
}

async function navigateToBalance(page) {
  // 1. Intentar con el sidebar del ADMIN PRINCIPAL (fuera del iframe)
  for (const text of ['Resumen', 'Inicio', 'Balance', 'Billetera', 'Saldo']) {
    const link = page.locator('a, button').filter({ hasText: new RegExp(`^${text}$`, 'i') }).first();
    if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
      log(`Sidebar principal: navegando a "${text}"...`);
      await link.click();
      await page.waitForTimeout(3000);
      return;
    }
  }

  const frame = await waitForPaymentsFrame(page);
  if (!frame) return;

  log('iframe URL: ' + frame.url());

  // Loguear TODOS los elementos clickeables del iframe para diagnóstico
  const clickable = await frame.evaluate(() => {
    const els = [...document.querySelectorAll('a, button, [onclick], [class*="nav"], [class*="menu"], [class*="tab"], [class*="sidebar"], [class*="link"], [class*="item"]')];
    return [...new Set(els.map(e => e.innerText?.trim()).filter(t => t && t.length < 40))].slice(0, 30);
  }).catch(() => []);
  if (clickable.length) log('Clickeables iframe: ' + clickable.join(' | '));

  // 2. Intentar con cualquier elemento del iframe
  for (const text of ['Inicio', 'Home', 'Pago Nube', 'Billetera', 'Balance', 'Resumen', 'Dashboard', 'Saldo']) {
    const link = frame.locator('a, button, span, div, li').filter({ hasText: new RegExp(`^${text}$`, 'i') }).first();
    if (await link.isVisible({ timeout: 1000 }).catch(() => false)) {
      log(`iframe: navegando a "${text}"...`);
      await link.click();
      await frame.waitForTimeout(3000);
      return;
    }
  }

  // 3. Intentar navegar al home de la SPA via hash
  const iframeUrl = frame.url();
  if (iframeUrl && iframeUrl !== 'about:blank') {
    try {
      const homeUrl = new URL(iframeUrl);
      homeUrl.hash = '';
      homeUrl.pathname = homeUrl.pathname.replace(/\/(transfers|transferencias|transacciones|movimientos|history).*$/, '/');
      if (homeUrl.href !== iframeUrl) {
        log(`Navegando a home SPA: ${homeUrl.href}`);
        await frame.goto(homeUrl.href, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await frame.waitForTimeout(3000);
        return;
      }
    } catch {}
  }

  log('No se encontró nav de balance — usando vista actual.');
}

async function waitForPaymentsFrame(page, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const frame = getPaymentsFrame(page);
    if (frame) return frame;
    await page.waitForTimeout(1500);
  }
  const urls = page.frames().map(f => f.url()).filter(u => u && u !== 'about:blank');
  log('TODOS los frames: ' + (urls.join(' | ') || 'ninguno'));
  return null;
}

async function waitForFrameContent(frame, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const txt = await frame.evaluate(() => document.body.innerText).catch(() => '');
    if (txt.trim().length > 50) return txt;
    await frame.waitForTimeout(1500);
  }
  return await frame.evaluate(() => document.body.innerText).catch(() => '');
}

async function getAvailableAmount(page) {
  const frame = await waitForPaymentsFrame(page);

  let txt;
  if (frame) {
    txt = await waitForFrameContent(frame);
  } else {
    log('iframe services-financials no encontrado — buscando saldo en página principal...');
    await page.waitForTimeout(3000);
    txt = await page.evaluate(() => document.body.innerText).catch(() => '');
  }
  if (!txt || txt.trim().length < 20) { log('ERROR: No se pudo leer contenido de Pago Nube'); return null; }
  log('Texto contenido (primeros 600 chars):\n' + txt.slice(0, 600));

  const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);

  // Intento 1: buscar "saldo disponible" y luego el monto en las siguientes líneas
  for (let i = 0; i < lines.length; i++) {
    if (/saldo disponible/i.test(lines[i])) {
      for (let j = i; j < Math.min(i + 6, lines.length); j++) {
        const m = lines[j].match(/\$\s*([\d.,]+)/);
        if (m) return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      }
    }
  }

  // Intento 2: buscar "disponible" genérico seguido de monto
  for (let i = 0; i < lines.length; i++) {
    if (/disponible/i.test(lines[i])) {
      for (let j = i; j < Math.min(i + 6, lines.length); j++) {
        const m = lines[j].match(/\$\s*([\d.,]+)/);
        if (m) return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      }
    }
  }

  // Intento 3: buscar "retirar" o "transferir" y el monto cercano
  for (let i = 0; i < lines.length; i++) {
    if (/retirar|transferir/i.test(lines[i])) {
      for (let j = Math.max(0, i - 4); j < Math.min(i + 4, lines.length); j++) {
        const m = lines[j].match(/\$\s*([\d.,]+)/);
        if (m) return parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      }
    }
  }

  // Intento 4: cualquier monto en pesos presente en el iframe
  const allAmounts = txt.match(/\$\s*([\d.,]+)/g);
  log('Montos encontrados en iframe: ' + (allAmounts ? allAmounts.join(', ') : 'ninguno'));

  return null;
}

async function clickTransfer(page) {
  const frame = await waitForPaymentsFrame(page);
  const ctx = frame || page;
  for (const sel of ['button:has-text("Transferir")', 'a:has-text("Transferir")', 'button:has-text("Retirar")']) {
    const btn = ctx.locator(sel).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      return true;
    }
  }
  return false;
}

async function confirmTransfer(page) {
  await page.waitForTimeout(2500);
  const frame = await waitForPaymentsFrame(page);
  const ctx = frame || page;
  for (const sel of ['button:has-text("Transferir")', 'button:has-text("Confirmar")', 'button:has-text("Aceptar")']) {
    const btn = ctx.locator(sel).first();
    if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await btn.click();
      log('Confirmación final ✓');
      await page.waitForTimeout(3000);
      return true;
    }
  }
  return false;
}

async function run() {
  if (SETUP) return setupSession();
  log('=== Verificando saldo Pago Nube ===');

  const browser = await chromium.launch({ headless: !DEBUG });
  const contextOpts = existsSync(SESSION) ? { storageState: SESSION } : {};
  const context = await browser.newContext({ ...contextOpts, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await page.goto(PAGONUBE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    if (!page.url().includes('mitiendanube.com/admin')) {
      if (CI) {
        log('SESIÓN VENCIDA — GitHub enviará email de notificación.');
        log('Solución: correr "node transfer.js --setup" en tu PC y subir session.json como secreto TN_SESSION.');
        await browser.close();
        process.exit(1);
      }
      await login(page, context);
      await page.goto(PAGONUBE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    // Esperar que cargue la SPA
    await page.waitForFunction(
      () => !document.querySelector('[class*="spinner"], [class*="loading"]'),
      { timeout: 20000 }
    ).catch(() => {});
    await page.waitForTimeout(3000);

    if (DEBUG) await screenshot(page, 'pagonube-page');

    await navigateToBalance(page);
    const amount = await getAvailableAmount(page);

    if (amount === null) {
      log('No se pudo detectar el saldo. Revisá los logs.');
      await browser.close();
      return;
    }

    log(`Saldo disponible: $${amount.toFixed(2)}`);

    if (amount <= MIN_AMOUNT) {
      log('Sin saldo para transferir.');
      await saveSession(context);
      await browser.close();
      return;
    }

    const clicked = await clickTransfer(page);
    if (!clicked) {
      log('ERROR: No se encontró el botón Transferir.');
      await browser.close();
      return;
    }
    log('Botón "Transferir" clickeado ✓');

    await confirmTransfer(page);
    await saveSession(context);
    log(`✓ TRANSFERENCIA COMPLETADA — $${amount.toFixed(2)} enviados.`);

  } catch (err) {
    log(`ERROR: ${err.message}`);
  }

  await browser.close();
}

run().catch(err => log(`FATAL: ${err.message}`));
