/**
 * FindIt OTP email sender
 *
 * 1. Deploy this project as a Web app, executing as you.
 * 2. Set access to Anyone.
 * 3. In Project Settings > Script properties, add:
 *    FINDIT_SHARED_SECRET = the same long random secret stored in Vercel.
 * 4. Authorize MailApp when prompted.
 */

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const savedSecret = PropertiesService.getScriptProperties()
      .getProperty("FINDIT_SHARED_SECRET");

    if (!savedSecret || !data.secret || data.secret !== savedSecret) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    const email = String(data.email || "").trim().toLowerCase();
    const token = String(data.token || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(token)) {
      return jsonResponse({ ok: false, error: "Invalid request" });
    }

    if (!lock.tryLock(10000)) {
      return jsonResponse({ ok: false, error: "Busy. Try again." });
    }

    const remaining = MailApp.getRemainingDailyQuota();
    if (remaining < 1) {
      return jsonResponse({ ok: false, error: "Daily email quota reached" });
    }

    const subject = "Your FindIt verification code";
    const textBody = "Your FindIt verification code is " + token +
      ". It expires in 5 minutes. Do not share this code with anyone.";
    const htmlBody =
      '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;color:#29232a">' +
      '<h2 style="color:#d94f86">FindIt verification</h2>' +
      '<p>Use this code to sign in to FindIt:</p>' +
      '<div style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 0">' +
      token + '</div>' +
      '<p>This code expires in 5 minutes. Never share it with anyone.</p>' +
      '<p style="color:#777;font-size:12px">If you did not request this code, you can ignore this email.</p>' +
      '</div>';

    MailApp.sendEmail({
      to: email,
      subject: subject,
      body: textBody,
      htmlBody: htmlBody,
      name: "FindIt"
    });

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("FindIt email sender error: " + error.message);
    return jsonResponse({ ok: false, error: "Email send failed" });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function jsonResponse(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

// Run once from the Apps Script editor to authorize and check the account quota.
function checkFindItMailQuota() {
  Logger.log("Remaining recipients today: " + MailApp.getRemainingDailyQuota());
}
