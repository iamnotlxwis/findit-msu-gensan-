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
    return parts.length === 2 && parts[0] === "v1" && received.length === wanted.length &&
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

  let rawBody = "";
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    rawBody = Buffer.concat(chunks).toString("utf8");
    if (!verifySupabaseHook(rawBody, req.headers, hookSecret)) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }

    const payload = JSON.parse(rawBody);
    const email = payload.user && payload.user.email;
    const emailData = payload.email_data || {};
    const token = emailData.token;

    if (!email || !/^[0-9]{6}$/.test(String(token || ""))) {
      return res.status(400).json({ error: "Invalid email or OTP payload." });
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
      return res.status(502).json({ error: "The email provider could not send the code." });
    }

    return res.status(200).json({});
  } catch (error) {
    console.error("FindIt email hook failed:", error.message);
    return res.status(500).json({ error: "Unable to deliver verification email." });
  }
};

module.exports.config = { api: { bodyParser: false } };
