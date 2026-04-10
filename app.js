const supabase = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "LA_TUA_ANON_KEY_COMPLETA"
);

async function aggiungiMovimento() {
  const movimento = {
    descrizione: "Movimento test",
    importo: Math.floor(Math.random() * 200),
    data: new Date().toISOString()
  };

  const { error } = await supabase
    .from("movimenti")
    .insert([movimento]);

  if (error) {
    console.error(error);
    alert("Errore: " + error.message);
    return;
  }

  caricaMovimenti();
}

async function caricaMovimenti() {
  const { data, error } = await supabase
    .from("movimenti")
    .select("*")
    .order("data", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }

  document.getElementById("movimenti").innerHTML =
    data.map(m => `
      <div style="padding:10px;border-bottom:1px solid #333">
        ${new Date(m.data).toLocaleDateString()} - 
        ${m.descrizione} - 
        €${m.importo}
      </div>
    `).join('');
}

caricaMovimenti();
