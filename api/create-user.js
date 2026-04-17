// api/create-user.js — Crea utente direttamente con email + password

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, nome, cognome, role, locationId, businessId } = req.body;
  if (!email || !password || !businessId) {
    return res.status(400).json({ error: 'Email, password e businessId obbligatori' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Configurazione server mancante' });
  }

  try {
    // 1. Crea utente con Admin API
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // Conferma email automaticamente
        user_metadata: { full_name: `${nome||''} ${cognome||''}`.trim() }
      })
    });

    const userData = await createRes.json();
    if (!createRes.ok) {
      return res.status(400).json({ error: userData.message || 'Errore creazione utente' });
    }

    const userId = userData.id;

    // 2. Assegna ruolo al business
    const roleRes = await fetch(`${supabaseUrl}/rest/v1/user_roles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_id: userId,
        business_id: businessId,
        role: role || 'cashier',
        location_id: locationId || null
      })
    });

    if (!roleRes.ok) {
      const roleErr = await roleRes.json();
      return res.status(400).json({ error: 'Utente creato ma errore assegnazione ruolo: ' + (roleErr.message||'') });
    }

    return res.status(200).json({ success: true, userId });

  } catch (err) {
    console.error('create-user error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
