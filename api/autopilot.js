export default function handler(req, res) {
  const mov = req.body.movimenti;

  const totale = mov.reduce((a,b)=>a+b.importo,0);

  const azioni = [];

  if (totale < 0) {
    azioni.push({
      messaggio: "Taglia costi subito"
    });
  }

  res.json({ azioni });
}
