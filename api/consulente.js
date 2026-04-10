export default function handler(req, res) {
  const mov = req.body.movimenti;

  const totale = mov.reduce((a,b)=>a+b.importo,0);

  const insights = [];

  if (totale < 0) {
    insights.push("Stai perdendo soldi");
  } else {
    insights.push("Situazione positiva");
  }

  res.json({ insights });
}
