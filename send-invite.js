// api/send-invite.js — CommonJS per Vercel Hobby

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, role, inviteLink, businessName } = req.body;

  if (!email || !inviteLink) {
    return res.status(400).json({ error: 'Email e link obbligatori' });
  }

  const roleLabel = { owner: 'Owner', admin: 'Admin', cashier: 'Cassiere' }[role] || role;

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:40px 20px}
.c{max-width:500px;margin:0 auto;background:#0a0f1e;border-radius:16px;overflow:hidden}
.h{padding:32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08)}
.li{display:inline-block;width:40px;height:40px;background:#2563eb;border-radius:10px;color:white;font-weight:800;font-size:20px;line-height:40px;text-align:center}
.lt{color:white;font-size:22px;font-weight:800;letter-spacing:.1em;vertical-align:middle;margin-left:8px}
.b{padding:32px}
.t{color:white;font-size:22px;font-weight:700;margin-bottom:12px}
.p{color:#9ca3af;font-size:15px;line-height:1.6;margin-bottom:24px}
.badge{display:inline-block;background:rgba(59,130,246,.15);color:#60a5fa;padding:4px 12px;border-radius:100px;font-size:13px;font-weight:600;margin-bottom:24px}
.btn{display:block;background:#2563eb;color:white!important;text-decoration:none;padding:14px 24px;border-radius:10px;text-align:center;font-weight:700;font-size:15px;margin-bottom:24px}
.lbox{background:rgba(255,255,255,.05);border-radius:8px;padding:12px 16px;font-family:monospace;font-size:12px;color:#9ca3af;word-break:break-all;margin-bottom:24px}
.f{color:#4b5563;font-size:12px;text-align:center;padding:20px 32px;border-top:1px solid rgba(255,255,255,.05)}
.f a{color:#4b5563;text-decoration:none}
</style></head>
<body><div class="c">
<div class="h"><span class="li">K</span><span class="lt">KONTRO</span></div>
<div class="b">
<div class="t">Sei stato invitato 🎉</div>
<p class="p">Sei stato invitato a unirti a <strong style="color:white">${businessName || 'un\'azienda'}</strong> su KONTRO.</p>
<div class="badge">Ruolo: ${roleLabel}</div><br><br>
<a href="${inviteLink}" class="btn">Accetta invito →</a>
<p class="p" style="font-size:13px">Oppure copia questo link:</p>
<div class="lbox">${inviteLink}</div>
<p class="p" style="font-size:12px;color:#4b5563">L'invito scade tra 7 giorni.</p>
</div>
<div class="f">KONTRO — Prima nota digitale · <a href="https://www.kontro.cloud">www.kontro.cloud</a></div>
</div></body></html>`;

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'RESEND_API_KEY non configurata' });
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'KONTRO <noreply@kontro.cloud>',
        to: [email],
        subject: `Sei stato invitato su KONTRO come ${roleLabel}`,
        html: htmlBody
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', JSON.stringify(data));
      return res.status(500).json({ error: data.message || 'Errore Resend' });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    console.error('Fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
