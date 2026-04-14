// api/welcome.js — Email di benvenuto per nuovi utenti

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, name, businessName } = req.body;
  if (!email) return res.status(400).json({ error: 'Email obbligatoria' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY non configurata' });

  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:40px 20px}
.c{max-width:520px;margin:0 auto;background:#0a0f1e;border-radius:16px;overflow:hidden}
.h{padding:32px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08)}
.li{display:inline-block;width:40px;height:40px;background:#2563eb;border-radius:10px;color:white;font-weight:800;font-size:20px;line-height:40px;text-align:center}
.lt{color:white;font-size:22px;font-weight:800;letter-spacing:.1em;vertical-align:middle;margin-left:8px}
.b{padding:32px}
.t{color:white;font-size:24px;font-weight:700;margin-bottom:12px}
.p{color:#9ca3af;font-size:15px;line-height:1.6;margin-bottom:20px}
.box{background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.3);border-radius:12px;padding:20px;margin-bottom:24px}
.box-title{color:#60a5fa;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px}
.feat{color:#d1d5db;font-size:14px;padding:5px 0;display:flex;align-items:center;gap:8px}
.btn{display:block;background:#2563eb;color:white!important;text-decoration:none;padding:14px 24px;border-radius:10px;text-align:center;font-weight:700;font-size:15px;margin-bottom:16px}
.btn2{display:block;background:rgba(255,255,255,.06);color:#d1d5db!important;text-decoration:none;padding:12px 24px;border-radius:10px;text-align:center;font-weight:600;font-size:14px;margin-bottom:24px}
.f{color:#4b5563;font-size:12px;text-align:center;padding:20px 32px;border-top:1px solid rgba(255,255,255,.05);line-height:1.8}
</style></head>
<body><div class="c">
  <div class="h">
    <span class="li">K</span><span class="lt">KONTRO</span>
  </div>
  <div class="b">
    <div class="t">Benvenuto su KONTRO! 🎉</div>
    <p class="p">Ciao <strong style="color:white">${name || 'a te'}</strong>,<br>
    il tuo account per <strong style="color:white">${businessName || 'la tua attività'}</strong> è pronto.<br>
    Inizia subito a gestire la tua prima nota digitale.</p>

    <div class="box">
      <div class="box-title">✨ Cosa puoi fare con KONTRO</div>
      <div class="feat">📒 Prima nota digitale a 3 turni (mattina, pomeriggio, sera)</div>
      <div class="feat">🏦 Banca & finanza — assegni, versamenti, RID</div>
      <div class="feat">👥 Gestione dipendenti e planning turni</div>
      <div class="feat">📊 Dashboard con conciliazione fiscale</div>
      <div class="feat">📦 Gestione fornitori e fatture</div>
    </div>

    <a href="https://www.kontro.cloud" class="btn">Accedi a KONTRO →</a>
    <a href="https://www.kontro.cloud/landing" class="btn2">Scopri tutti i piani</a>

    <p class="p" style="font-size:13px">Hai bisogno di aiuto? Rispondi a questa email o scrivici su <a href="https://www.kontro.cloud" style="color:#60a5fa">kontro.cloud</a>.</p>
  </div>
  <div class="f">
    KONTRO — Prima nota digitale per bar e ristoranti<br>
    <a href="https://www.kontro.cloud" style="color:#4b5563">www.kontro.cloud</a> · 
    <a href="mailto:info@kontro.cloud" style="color:#4b5563">info@kontro.cloud</a>
  </div>
</div></body></html>`;

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
        subject: `Benvenuto su KONTRO, ${name || ''}! 🎉`,
        html: htmlBody
      })
    });

    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.message || 'Errore Resend' });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Welcome email error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
