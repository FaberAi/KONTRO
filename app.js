const supabase = window.supabase.createClient(
  "https://imghqxftitokjkajtjjc.supabase.co",
  "INCOLLA_LA_TUA_ANON_KEY"
);

async function aggiungiMovimento() {
  const { error } = await supabase
    .from("movimenti")
    .insert([{
      descrizione: "test",
      importo: 10,
      data: new Date().toISOString()
    }]);

  if (error) {
    alert(error.message);
    return;
  }

  alert("ok salvato");
}
