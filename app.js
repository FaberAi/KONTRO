const client = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "METTI_QUI_LA_TUA_ANON_KEY_VERA"
);

document.getElementById("stato").textContent = "JS caricato";

async function aggiungiMovimento() {
  alert("click ricevuto");

  const { error } = await client
    .from("movimenti")
    .insert([
      {
        descrizione: "test",
        importo: 10,
        data: new Date().toISOString()
      }
    ]);

  if (error) {
    alert("Errore Supabase: " + error.message);
    return;
  }

  alert("ok salvato");
}
