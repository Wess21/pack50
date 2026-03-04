import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  try {
    console.log("Navigating to localhost:3000");
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    console.log("Logging in...");
    await page.type('#username', 'admin');
    await page.type('#password', 'changeme_OtzZjXJDMu4=');
    await page.click('#loginBtn');

    await page.waitForSelector('#adminPanel:not(.hidden)');
    console.log("Login successful");

    // Navigate to Contacts
    console.log("Navigating to Contacts tab...");
    await page.evaluate(() => switchTab('contacts', true));
    await page.waitForFunction(() => document.getElementById('contactsTab').classList.contains('active'));

    console.log("Testing config save...");
    await page.select('#contactTransport', 'email');
    await page.type('#contactDestination', 'test@example.com');
    await page.click('#contactConfigForm button[type="submit"]');

    await page.waitForFunction(() => {
      const el = document.getElementById('contactConfigStatus');
      return !el.classList.contains('hidden') && el.classList.contains('success');
    });
    console.log("Config saved successfully!");

    // Reload
    console.log("Reloading page...");
    await page.reload({ waitUntil: 'networkidle0' });

    // Wait a brief moment for the DOMContentLoaded event to trigger switchTab
    await new Promise(r => setTimeout(r, 1000));

    const isContactsActive = await page.evaluate(() => {
      return document.getElementById('contactsTab').classList.contains('active');
    });
    console.log("Is Contacts tab active on reload?", isContactsActive);
    if (!isContactsActive) {
      console.error("Contacts tab DID NOT stay active on reload. Check DOMContentLoaded logic.");
    }

    // Password change
    console.log("Navigating to Settings tab to change password...");
    await page.evaluate(() => switchTab('settings', true));
    await page.waitForFunction(() => document.getElementById('settingsTab').classList.contains('active'));

    await page.type('#currentPassword', 'changeme_OtzZjXJDMu4=');
    await page.type('#newPassword', 'newpassword123');
    await page.type('#confirmPassword', 'newpassword123');
    await page.click('#changePasswordForm button[type="submit"]');

    await page.waitForFunction(() => {
      const el = document.getElementById('passwordStatus');
      return !el.classList.contains('hidden');
    });

    const statusHtml = await page.evaluate(() => document.getElementById('passwordStatus').outerHTML);
    console.log("Password status:", statusHtml);
    if (statusHtml.includes('success')) {
      console.log("Password change SUCCEEDED!");
      // Restore password back so as not to break the next test
      await page.evaluate(() => document.getElementById('changePasswordForm').reset());
      await page.type('#currentPassword', 'newpassword123');
      await page.type('#newPassword', 'changeme_OtzZjXJDMu4=');
      await page.type('#confirmPassword', 'changeme_OtzZjXJDMu4=');
      await page.click('#changePasswordForm button[type="submit"]');
      await page.waitForFunction(() => {
        const el = document.getElementById('passwordStatus');
        return el.innerText.includes('успешно');
      });
      console.log("Password restored to original value.");
    } else {
      console.error("Password change FAILED.");
    }
  } catch (err) {
    console.error("Error during test:", err);
  } finally {
    await browser.close();
  }
})();
