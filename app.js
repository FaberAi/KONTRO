const supabase = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "TUA_ANON_KEY"
);

async function aggiungiMovimento() {
  const movimento = {
    descrizione: "Movimento test",
    importo: Math.floor(Math.random() * 200),
    data: new Date().toISOString()
  };

  const { error } = await supabase.from("movimenti").insert([movimento]);

  if (error) {
    console.error(error);
    alert(error.message);
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
    data.map(m => `<div>${m.descrizione} - €${m.importo}</div>`).join('');
}

caricaMovimenti();
