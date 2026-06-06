import { chromium, type Page } from 'playwright';

const OUT_DIR = 'docs/images';
const BASE_URL = 'http://127.0.0.1:9999';

async function maskSensitive(page: Page) {
  await page.evaluate(() => {
    const uuidRe = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const pathRe = /\/Users\/[^\s]+|~\/[^\s]+/g;

    // Mask project names in sidebar first column
    document.querySelectorAll('aside table tbody tr td:first-child, [role="complementary"] table tbody tr td:first-child').forEach((el, i) => {
      const text = el.textContent || '';
      if (text.trim() && text.trim() !== '—' && !text.includes('/')) {
        el.textContent = `project-${String.fromCharCode(97 + (i % 26))}`;
      }
    });

    // Mask session IDs and long hex strings
    document.querySelectorAll('td, span, div').forEach((el) => {
      if (uuidRe.test(el.textContent || '')) {
        el.textContent = (el.textContent || '').replace(uuidRe, 'session-id');
      }
    });

    // Mask file paths
    document.querySelectorAll('td, code, .settings-meta').forEach((el) => {
      if (pathRe.test(el.textContent || '')) {
        el.textContent = (el.textContent || '').replace(pathRe, '~/path/to/file');
      }
    });

    // Mask stale/hook/error log messages in session rows
    document.querySelectorAll('table tbody tr td').forEach((el) => {
      const text = el.textContent || '';
      if (text.includes('stale') || text.includes('hook') || text.includes('error') || text.includes('SessionEnd') || text.includes('blocking')) {
        el.textContent = 'log-message';
      }
    });

    // Mask meta-docs path column (3rd column)
    document.querySelectorAll('table tbody tr').forEach((row) => {
      const cells = row.querySelectorAll('td');
      if (cells.length >= 3) {
        const pathCell = cells[2];
        if (pathCell && (pathCell.textContent || '').includes('/')) {
          pathCell.textContent = '~/path/to/file';
        }
      }
    });
  });
}

async function dismissUpdateDialog(page: Page) {
  try {
    const dialog = page.locator('dialog');
    if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
      await dialog.evaluate((el: HTMLDialogElement) => el.close());
    }
  } catch { /* ignore */ }
}

async function setEnglish(page: Page) {
  // Find language dropdown and select English
  const langCombo = page.locator('select, [role="combobox"]').filter({ hasText: /한국어|English|日本語|中文/ }).first();
  if (await langCombo.isVisible({ timeout: 2000 }).catch(() => false)) {
    await langCombo.selectOption('English');
    await page.waitForTimeout(600);
  }
}

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // ── 1. Dashboard ──
  await page.goto(`${BASE_URL}/`);
  await page.waitForTimeout(2000);
  await setEnglish(page);
  await dismissUpdateDialog(page);
  await maskSensitive(page);
  await page.screenshot({ path: `${OUT_DIR}/dashboard.png`, type: 'png' });
  console.log('✓ dashboard.png');

  // ── 2. Session detail (turn view) ──
  // Click first session row in sidebar
  const firstSession = page.locator('table tbody tr').first();
  if (await firstSession.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstSession.click();
    await page.waitForTimeout(800);
    await dismissUpdateDialog(page);
    await maskSensitive(page);
    await page.screenshot({ path: `${OUT_DIR}/session-turn-view.png`, type: 'png' });
    console.log('✓ session-turn-view.png');
  } else {
    console.log('⚠ No sessions found, skipping session-turn-view.png');
  }

  // ── 3. Meta-docs catalog ──
  await page.goto(`${BASE_URL}/meta-docs`);
  await page.waitForTimeout(2000);
  await setEnglish(page);
  await dismissUpdateDialog(page);
  await maskSensitive(page);
  await page.screenshot({ path: `${OUT_DIR}/meta-docs-catalog.png`, type: 'png' });
  console.log('✓ meta-docs-catalog.png');

  // ── 4. Settings → Integration tab ──
  await page.goto(`${BASE_URL}/settings`);
  await page.waitForTimeout(2000);
  await setEnglish(page);
  await dismissUpdateDialog(page);
  // Click Integration tab
  const integrationTab = page.getByRole('tab', { name: /Integration|연동/ });
  if (await integrationTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await integrationTab.click();
    await page.waitForTimeout(500);
  }
  await maskSensitive(page);
  await page.screenshot({ path: `${OUT_DIR}/settings-integration.png`, type: 'png' });
  console.log('✓ settings-integration.png');

  // ── 5. Settings → Server/Logs tab ──
  const serverTab = page.getByRole('tab', { name: /Server|서버/ });
  if (await serverTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await serverTab.click();
    await page.waitForTimeout(500);
  }
  await maskSensitive(page);
  await page.screenshot({ path: `${OUT_DIR}/settings-server-logs.png`, type: 'png' });
  console.log('✓ settings-server-logs.png');

  await browser.close();
  console.log('Done.');
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
