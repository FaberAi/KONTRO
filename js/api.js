let movimenti = [];

async function aggiungi() {
  const mov = {
    descrizione: "Spesa",
    importo: -Math.floor(Math.random() * 100),
    data: new Date().toLocaleDateString()
  };

  await fetch('/api/movimenti', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(mov)
  });

  carica();
}

async function carica() {
  const res = await fetch('/api/movimenti');
  movimenti = await res.json();

  render();
  consulente();
  autopilot();
}

function render() {
  document.getElementById('movimenti').innerHTML =
    movimenti.map(m => `
      <div>${m.data} - ${m.descrizione} - €${m.importo}</div>
    `).join('');
}

async function consulente() {
  const res = await fetch('/api/consulente', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ movimenti })
  });

  const r = await res.json();

  document.getElementById('consulente').innerHTML =
    r.insights.map(i=>`<div>👉 ${i}</div>`).join('');
}

async function autopilot() {
  const res = await fetch('/api/autopilot', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ movimenti })
  });

  const r = await res.json();

  document.getElementById('autopilot').innerHTML =
    r.azioni.map(a=>`<div>⚙️ ${a.messaggio}</div>`).join('');
}

carica();
