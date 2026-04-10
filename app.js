let movimenti = [];

function entra() {
  document.getElementById('landing').style.display = 'none';
  document.getElementById('app').style.display = 'block';
}

function aggiungi() {
  const mov = {
    descrizione: "Test",
    importo: Math.floor(Math.random() * 200),
    data: new Date().toLocaleDateString()
  };

  movimenti.push(mov);
  render();
}

function render() {
  document.getElementById('lista').innerHTML =
    movimenti.map(m => `
      <div>${m.data} - ${m.descrizione} - €${m.importo}</div>
    `).join('');
}
