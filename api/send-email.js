const crypto = require("node:crypto");

function verifySupabaseHook(rawBody, headers, secret) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatures = headers["webhook-signature"];
  if (!id || !timestamp || !signatures) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^v1,whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(id + "." + timestamp + "." + rawBody)
    .digest("base64");

  return signatures.split(" ").some((entry) => {
    const parts = entry.split(",");
    const received = Buffer.from(parts[1] || "");
    const wanted = Buffer.from(expected);
    return parts.length === 2 && parts[0] === "v1" &&
      received.length === wanted.length &&
      crypto.timingSafeEqual(received, wanted);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const hookSecret = process.env.SUPABASE_SEND_EMAIL_HOOK_SECRET;
  const gasUrl = process.env.GAS_WEB_APP_URL;
  const gasSecret = process.env.GAS_SHARED_SECRET;

  if (!hookSecret || !gasUrl || !gasSecret) {
    return res.status(500).json({ error: "Email delivery is not configured." });
  }

  try {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const rawBody = Buffer.concat(chunks).toString("utf8");

    if (!verifySupabaseHook(rawBody, req.headers, hookSecret)) {
      return res.status(401).json({
        error: { http_code: 401, message: "Invalid webhook signature." }
      });
    }

    const payload = JSON.parse(rawBody);
    const user = payload.user || {};
    const emailData = payload.email_data || payload.email || {};
    const email = user.email;
    const token = String(emailData.token || "").trim();

    if (!email || !/^\d{6}$/.test(token)) {
      console.error("Invalid Supabase email hook payload:", {
        hasUser: Boolean(payload.user),
        hasEmail: Boolean(email),
        emailDataKeys: Object.keys(emailData),
        tokenType: typeof emailData.token,
        tokenLength: token.length,
        tokenIsNumeric: /^\d+$/.test(token)
      });
      return res.status(400).json({
        error: { http_code: 400, message: "Invalid email or OTP payload." }
      });
    }

    const response = await fetch(gasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: gasSecret,
        email,
        token,
        action: emailData.email_action_type || "verification"
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      console.error("Apps Script email sender rejected request:", {
        status: response.status,
        error: result.error || "Unknown error"
      });
      return res.status(502).json({
        error: {
          http_code: 502,
          message: "The email provider could not send the code."
        }
      });
    }

    return res.status(200).json({});
  } catch (error) {
    console.error("FindIt email hook failed:", error.message);
    return res.status(500).json({
      error: { http_code: 500, message: "Unable to deliver verification email." }
    });
  }
};

module.exports.config = { api: { bodyParser: false } };
