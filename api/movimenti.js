let db = [];

export default function handler(req, res) {

  if (req.method === 'POST') {
    db.push(req.body);
    return res.json({ ok: true });
  }

  if (req.method === 'GET') {
    return res.json(db);
  }
}
