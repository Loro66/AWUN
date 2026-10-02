const { test, expect } = require('@playwright/test');
const { openAwun, TRACKS } = require('./fixtures');

test('guest library merges into an account, restores on a fresh device, then clears on sign-out', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = { id: 'd6d229bf-e421-4ddc-898f-1aac3eadac43', email: 'listener@example.com' };
  const cloud = { revision: 0, library: [], playlists: [] };
  let signedIn = false;
  await page.route('**/api/v1/account/**', async route => {
    const url = new URL(route.request().url());
    const operation = url.pathname.split('/').pop();
    if (operation === 'config') return route.fulfill({ json: { enabled: true } });
    if (operation === 'session') return route.fulfill({ status: signedIn ? 200 : 401, json: signedIn ? user : { detail: 'Sign in again' } });
    if (operation === 'login') { signedIn = true; return route.fulfill({ json: { email: user.email } }); }
    if (operation === 'logout') { signedIn = false; return route.fulfill({ json: { ok: true } }); }
    if (operation === 'library' && route.request().method() === 'GET') return route.fulfill({ json: cloud });
    if (operation === 'library' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (body.revision !== cloud.revision) return route.fulfill({ status: 409, json: { detail: 'Conflict' } });
      Object.assign(cloud, { revision: cloud.revision + 1, library: body.library, playlists: body.playlists });
      return route.fulfill({ json: { revision: cloud.revision } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await page.addInitScript(track => {
    if (!localStorage.getItem('seeded-account-e2e')) {
      localStorage.setItem('awun-library', JSON.stringify([track]));
      localStorage.setItem('seeded-account-e2e', 'yes');
    }
  }, TRACKS.audius[0]);
  await openAwun(page);
  await page.locator('#themeButton').click();
  await expect(page.locator('#accountForm')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile-settings.png') });
  await page.locator('#accountEmail').fill(user.email);
  await page.locator('#accountPassword').fill('long-secure-password');
  await page.locator('#accountLogin').click();
  await expect(page.locator('#accountChoice')).toBeVisible();
  await page.locator('#accountMerge').click();
  await expect.poll(() => cloud.revision).toBe(1);
  expect(cloud.library.map(track => track.id)).toContain(TRACKS.audius[0].id);
  await expect(page.locator('#accountStatus')).toContainText('синхронизирована');
  await page.evaluate(() => {
    localStorage.removeItem('awun-library');
    localStorage.removeItem('awun-playlists-v1');
    localStorage.removeItem('songvale-account-owner-v1');
  });
  await page.reload();
  await page.locator('#themeButton').click();
  await expect(page.locator('#accountConnected')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.awunApp.state.saved.length)).toBe(1);
  await page.locator('#accountLogout').click();
  await expect(page.locator('#accountForm')).toBeVisible();
  expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('songvale-account-owner-v1'))).toBeNull();
  expect(await page.evaluate(async () => (await window.awunStorage.latestBackup()).data['awun-library'])).toBe('[]');
});

test('conflicting library edits keep local changes until the user combines copies', async ({ page }) => {
  const user = { id: 'd6d229bf-e421-4ddc-898f-1aac3eadac43', email: 'listener@example.com' };
  const cloud = { revision: 1, library: [TRACKS.audius[0]], playlists: [] };
  await page.route('**/api/v1/account/**', route => {
    const operation = new URL(route.request().url()).pathname.split('/').pop();
    if (operation === 'config') return route.fulfill({ json: { enabled: true } });
    if (operation === 'session') return route.fulfill({ json: user });
    if (operation === 'library' && route.request().method() === 'GET') return route.fulfill({ json: cloud });
    if (operation === 'library' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (body.revision !== cloud.revision) return route.fulfill({ status: 409, json: { detail: 'Conflict' } });
      Object.assign(cloud, { revision: cloud.revision + 1, library: body.library, playlists: body.playlists });
      return route.fulfill({ json: { revision: cloud.revision } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await openAwun(page);
  await expect.poll(() => page.evaluate(() => window.awunApp.state.saved.length)).toBe(1);
  Object.assign(cloud, { revision: 2, library: [TRACKS.audius[0], TRACKS.jamendo[0]] });
  await searchAndSave(page);
  await page.locator('#themeButton').click();
  await expect(page.locator('#accountChoice')).toBeVisible();
  expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(2);
  await page.locator('#accountMerge').click();
  await expect.poll(() => cloud.revision).toBe(3);
  expect(new Set(cloud.library.map(track => track.id))).toEqual(new Set([TRACKS.audius[0].id, TRACKS.jamendo[0].id, TRACKS.soundcloud[1].id]));
});

test('password recovery clears the link fragment and lets the user set a new password', async ({ page }) => {
  let emailSent = false, passwordChanged = false;
  await page.route('**/api/v1/account/**', route => {
    const operation = new URL(route.request().url()).pathname.split('/').slice(-2).join('/');
    if (operation.endsWith('/config')) return route.fulfill({ json: { enabled: true } });
    if (operation.endsWith('/session')) return route.fulfill({ status: 401, json: {} });
    if (operation.endsWith('/recover')) { emailSent = true; return route.fulfill({ json: { ok: true } }); }
    if (operation === 'recover/complete') {
      const body = route.request().postDataJSON();
      passwordChanged = body.access_token === 'test-recovery-token-for-browser' && body.password === 'replacement-password';
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await openAwun(page);
  await page.locator('#themeButton').click();
  await expect(page.locator('#accountForm')).toBeVisible();
  await page.locator('#accountEmail').fill('listener@example.com');
  await page.locator('#accountForgot').click();
  expect(emailSent).toBe(true);
  await expect(page.locator('#accountStatus')).toContainText('проверь почту');
  await page.goto('/?lang=ru#access_token=test-recovery-token-for-browser&type=recovery');
  await page.reload();
  await page.locator('#themeButton').click();
  await expect(page.locator('#accountRecoveryForm')).toBeVisible();
  await expect(page).not.toHaveURL(/access_token/);
  await page.locator('#accountNewPassword').fill('replacement-password');
  await page.locator('#accountRecoveryForm button[type="submit"]').click();
  await expect(page.locator('#accountStatus')).toContainText('Пароль обновлён');
  expect(passwordChanged).toBe(true);
  await expect(page.locator('#accountForm')).toBeVisible();
});

test('a different account never merges or displays the previous owner’s library', async ({ page }) => {
  const user = { id: 'd6d229bf-e421-4ddc-898f-1aac3eadac43', email: 'second@example.com' };
  await page.addInitScript(track => {
    localStorage.setItem('songvale-account-owner-v1', 'first-account');
    localStorage.setItem('awun-library', JSON.stringify([track]));
  }, TRACKS.audius[0]);
  await page.route('**/api/v1/account/**', route => {
    const operation = new URL(route.request().url()).pathname.split('/').pop();
    if (operation === 'config') return route.fulfill({ json: { enabled: true } });
    if (operation === 'session') return route.fulfill({ json: user });
    if (operation === 'library') return route.fulfill({ json: { revision: 0, library: [], playlists: [] } });
    if (operation === 'logout') return route.fulfill({ json: { ok: true } });
    return route.fulfill({ status: 404, json: {} });
  });
  await openAwun(page);
  await page.locator('#themeButton').click();
  await expect(page.locator('#accountChoice')).toBeVisible();
  await expect(page.locator('#accountMerge')).toBeHidden();
  expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(0);
  await page.locator('#accountLogout').click();
  await expect(page.locator('#accountForm')).toBeVisible();
  expect(await page.evaluate(() => window.awunApp.state.saved.length)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('songvale-account-owner-v1'))).toBe('first-account');
});

test('offline edits under the same account sync after reconnecting', async ({ page }) => {
  const user = { id: 'd6d229bf-e421-4ddc-898f-1aac3eadac43', email: 'listener@example.com' };
  const cloud = { revision: 1, library: [], playlists: [] };
  let enabled = false;
  await page.addInitScript(id => {
    localStorage.setItem('songvale-account-owner-v1', id);
    if (!localStorage.getItem(`songvale-account-sync-${id}`)) localStorage.setItem(`songvale-account-sync-${id}`, JSON.stringify({ revision: 1, dirty: false }));
  }, user.id);
  await page.route('**/api/v1/account/**', route => {
    const operation = new URL(route.request().url()).pathname.split('/').pop();
    if (operation === 'config') return route.fulfill({ json: { enabled } });
    if (operation === 'session') return route.fulfill({ json: user });
    if (operation === 'library' && route.request().method() === 'GET') return route.fulfill({ json: cloud });
    if (operation === 'library' && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      if (body.revision !== cloud.revision) return route.fulfill({ status: 409, json: {} });
      Object.assign(cloud, { revision: cloud.revision + 1, library: body.library });
      return route.fulfill({ json: { revision: cloud.revision } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  await openAwun(page);
  await searchAndSave(page);
  expect(await page.evaluate(id => JSON.parse(localStorage.getItem(`songvale-account-sync-${id}`)).dirty, user.id)).toBe(true);
  enabled = true;
  await page.reload();
  await expect.poll(() => cloud.revision).toBe(2);
  expect(cloud.library.map(track => track.id)).toContain(TRACKS.soundcloud[1].id);
});

async function searchAndSave(page) {
  await page.locator('#searchInput').fill('forest echo');
  await page.locator('#searchForm').evaluate(form => form.requestSubmit());
  const row=page.locator('#trackList .track[data-track-id="soundcloud_forest-echo"]');
  await expect(row).toBeVisible();
  await row.locator('.save').click();
}
