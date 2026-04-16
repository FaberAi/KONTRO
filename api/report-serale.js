// api/report-serale.js — Invia email report chiusura serale

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    businessName, data, sede, compilatore,
    entrate, uscite, incasso, differenza,
    fornitori, fatture,
    emailAdmin
  } = req.body;

  if (!emailAdmin) return res.status(400).json({ error: 'Email admin mancante' });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY non configurata' });

  const dataFmt = data ? new Date(data + 'T12:00:00').toLocaleDateString('it-IT', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  }) : '—';

  const fmtE = v => '€ ' + (parseFloat(v)||0).toLocaleString('it-IT', { minimumFractionDigits: 2 });
  const diffNum = parseFloat(differenza)||0;
  const diffColor = diffNum <= 0 ? '#4ade80' : '#f87171';

  const righeFornitoriHtml = (fornitori||[]).length > 0
    ? (fornitori||[]).map(f => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2d4a;color:#e2e8f0">${f.nome||'—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2d4a;color:#fbbf24;text-align:right">${fmtE(f.importo)}</td>
        </tr>`).join('')
    : '<tr><td colspan="2" style="padding:8px 12px;color:#64748b;font-style:italic">Nessun fornitore registrato</td></tr>';

  const righeFattureHtml = (fatture||[]).length > 0
    ? (fatture||[]).map(f => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2d4a;color:#e2e8f0">${f.numero ? 'N° '+f.numero : '—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2d4a;color:#e2e8f0">${f.fornitore||'—'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2d4a;color:#fbbf24;text-align:right">${fmtE(f.importo)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #1e2d4a;color:${f.stato==='pagata'?'#4ade80':'#f87171'};text-align:center">${f.stato==='pagata'?'✓ Pagata':'⏳ Aperta'}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="padding:8px 12px;color:#64748b;font-style:italic">Nessuna fattura registrata oggi</td></tr>';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
body{font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:30px 20px}
.c{max-width:600px;margin:0 auto;background:#0a0f1e;border-radius:16px;overflow:hidden}
.h{padding:28px 32px;border-bottom:1px solid rgba(255,255,255,.08)}
.li{display:inline-block;width:36px;height:36px;background:#2563eb;border-radius:9px;color:white;font-weight:900;font-size:18px;line-height:36px;text-align:center;vertical-align:middle}
.lt{color:white;font-size:20px;font-weight:800;letter-spacing:.1em;vertical-align:middle;margin-left:8px}
.badge{display:inline-block;background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(34,197,94,.3);padding:3px 12px;border-radius:100px;font-size:12px;font-weight:700;margin-top:4px}
.b{padding:28px 32px}
.title{color:white;font-size:20px;font-weight:800;margin-bottom:4px}
.sub{color:#64748b;font-size:13px;margin-bottom:24px}
.kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px}
.kpi{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px 16px}
.kpi-label{color:#64748b;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.kpi-val{font-size:22px;font-weight:800}
.section-title{color:#60a5fa;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(37,99,235,.25)}
table{width:100%;border-collapse:collapse;margin-bottom:8px}
th{background:#1e2d4a;color:#94a3b8;font-size:11px;font-weight:700;text-transform:uppercase;padding:8px 12px;text-align:left}
.f{color:#4b5563;font-size:11px;text-align:center;padding:20px 32px;border-top:1px solid rgba(255,255,255,.05);line-height:1.8}
</style></head>
<body><div class="c">
  <div class="h">
    <span class="li">K</span><span class="lt">KONTRO</span><br>
    <span class="badge">🌙 Chiusura serale</span>
  </div>
  <div class="b">
    <div class="title">Report giornaliero</div>
    <div class="sub">${dataFmt}${sede ? ' · ' + sede : ''} · Chiuso da <strong style="color:#e2e8f0">${compilatore||'—'}</strong></div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-label">Totale entrate</div>
        <div class="kpi-val" style="color:#4ade80">${fmtE(entrate)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Totale uscite</div>
        <div class="kpi-val" style="color:#f87171">${fmtE(uscite)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Incasso giornaliero</div>
        <div class="kpi-val" style="color:#fbbf24">${fmtE(incasso)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Differenza</div>
        <div class="kpi-val" style="color:${diffColor}">${fmtE(differenza)}</div>
      </div>
    </div>

    <div class="section-title">📦 Fornitori in prima nota</div>
    <table>
      <tr><th>Fornitore</th><th style="text-align:right">Importo</th></tr>
      ${righeFornitoriHtml}
    </table>

    <div class="section-title">🧾 Fatture registrate oggi</div>
    <table>
      <tr><th>N°</th><th>Fornitore</th><th style="text-align:right">Importo</th><th style="text-align:center">Stato</th></tr>
      ${righeFattureHtml}
    </table>
  </div>
  <div class="f">
    KONTRO — Prima nota digitale · <a href="https://www.kontro.cloud" style="color:#4b5563">www.kontro.cloud</a>
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
        to: Array.isArray(emailAdmin) ? emailAdmin : [emailAdmin],
        subject: `🌙 Chiusura ${businessName||'KONTRO'} — ${dataFmt}${sede ? ' · '+sede : ''}`,
        html
      })
    });
    const result = await response.json();
    if (!response.ok) return res.status(500).json({ error: result.message });
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
