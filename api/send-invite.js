// api/send-invite.js
// Vercel serverless function — invia email invito tramite Resend

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, role, inviteLink, businessName } = req.body;

  if (!email || !inviteLink) {
    return res.status(400).json({ error: 'Email e link obbligatori' });
  }

  const roleLabel = { owner: 'Owner', admin: 'Admin', cashier: 'Cassiere' }[role] || role;

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f4f4f4; margin: 0; padding: 40px 20px; }
        .container { max-width: 500px; margin: 0 auto; background: #0a0f1e; border-radius: 16px; overflow: hidden; }
        .header { background: #0a0f1e; padding: 32px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
        .logo { display: inline-flex; align-items: center; gap: 10px; }
        .logo-icon { width: 40px; height: 40px; background: #2563eb; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 20px; }
        .logo-text { color: white; font-size: 22px; font-weight: 800; letter-spacing: 0.1em; }
        .body { padding: 32px; }
        .title { color: white; font-size: 22px; font-weight: 700; margin-bottom: 12px; }
        .text { color: #9ca3af; font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
        .badge { display: inline-block; background: rgba(59,130,246,0.15); color: #60a5fa; padding: 4px 12px; border-radius: 100px; font-size: 13px; font-weight: 600; margin-bottom: 24px; }
        .btn { display: block; background: #2563eb; color: white !important; text-decoration: none; padding: 14px 24px; border-radius: 10px; text-align: center; font-weight: 700; font-size: 15px; margin-bottom: 24px; }
        .link-box { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 12px; color: #9ca3af; word-break: break-all; margin-bottom: 24px; }
        .footer { color: #4b5563; font-size: 12px; text-align: center; padding: 20px 32px; border-top: 1px solid rgba(255,255,255,0.05); }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">
            <div class="logo-icon">K</div>
            <span class="logo-text">KONTRO</span>
          </div>
        </div>
        <div class="body">
          <div class="title">Sei stato invitato 🎉</div>
          <p class="text">
            Sei stato invitato a unirti a <strong style="color:white">${businessName || 'un\'azienda'}</strong> su KONTRO — la piattaforma di prima nota digitale.
          </p>
          <div class="badge">Ruolo: ${roleLabel}</div>
          <a href="${inviteLink}" class="btn">Accetta invito →</a>
          <p class="text" style="font-size:13px">Se il pulsante non funziona, copia questo link nel browser:</p>
          <div class="link-box">${inviteLink}</div>
          <p class="text" style="font-size:12px;color:#4b5563">L'invito scade tra 7 giorni.</p>
        </div>
        <div class="footer">
          KONTRO — Prima nota digitale · kontro.vercel.app
        </div>
      </div>
    </body>
    </html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'KONTRO <onboarding@resend.dev>',
        to: [email],
        subject: `Sei stato invitato su KONTRO come ${roleLabel}`,
        html: htmlBody
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.message || 'Errore invio email' });
    }

    return res.status(200).json({ success: true, id: data.id });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
