import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { CardImage } from "../components/CardImage";
import { CATALOG_GAMES } from "../scanner/catalog-games";

export function CustomCardImportPage() {
  const [name, setName] = useState("");
  const [game, setGame] = useState("mtg");
  const [set, setSet] = useState("");
  const [number, setNumber] = useState("");
  const [image, setImage] = useState("");
  const [value, setValue] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  async function perform(action: () => Promise<string>) {
    setBusy(true); setError(""); setMessage("");
    try { setMessage(await action()); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not complete the request."); }
    finally { setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      await apiRequest("/api/v1/custom-cards", {method: "POST", body: JSON.stringify({
        name: name.trim(), game, set_name: set.trim(), collector_number: number.trim(),
        image_url: image.trim() || null, value_usd: value || null, quantity: Number(quantity),
      })});
      setName(""); setNumber(""); setImage(""); setValue(""); setQuantity("1");
      return "Added to your collection. Find it in Collection or add it to a deck from Cards.";
    });
  }
  return <section className="page-stack custom-card-import">
    <header className="page-header"><div><p className="eyebrow">Your collection, your cards</p>
      <h1>Custom Card Import</h1><p>Add a missing card without waiting for a catalog update.</p></div>
      <Link to="/collection">View collection</Link></header>
    {error && <p role="alert" className="error-message">{error}</p>}
    {message && <p role="status">{message}</p>}
    <div className="custom-card-layout">
      <form className="panel" onSubmit={save}>
        <h2>Add a card</h2><p>Private to your account and labeled as user supplied. Image, set details and value are optional.</p>
        <fieldset disabled={busy} className="custom-card-fields">
          <label>Card name<input required maxLength={512} value={name} onChange={e => setName(e.target.value)} /></label>
          <label>Game<select value={game} onChange={e => setGame(e.target.value)}><option value="custom">Other / Custom collectibles</option>{CATALOG_GAMES.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
          <label>Set name<input maxLength={240} value={set} onChange={e => setSet(e.target.value)} /></label>
          <label>Collector number<input maxLength={64} value={number} onChange={e => setNumber(e.target.value)} /></label>
          <label>Image URL<input type="url" placeholder="https://…" maxLength={2048} value={image} onChange={e => setImage(e.target.value)} /></label>
          <small>Use an HTTPS image you have permission to display. Your browser loads it from that host.</small>
          <label>Estimated value per card (USD)<input type="number" min="0" max="999999.99" step="0.01" value={value} onChange={e => setValue(e.target.value)} /></label>
          <label>Quantity<input required type="number" min="1" max="9999" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} /></label>
          <button type="submit">{busy ? "Working…" : "Add to collection"}</button>
        </fieldset>
      </form>
      <aside className="panel"><h2>Preview</h2><CardImage name={name || "Your custom card"} imageUris={image ? {custom: image} : {}} className="custom-card-image" />
        <h3>{name || "Your card name"}</h3><p>Custom card · User supplied</p><p>{set || "No set supplied"}{number && ` · #${number}`}</p>
        <p>Value: {value ? `$${value}` : "Not supplied"}</p>
      </aside>
    </div>
    <section className="panel"><h2>Import or export custom cards</h2>
      <p>Custom-card JSON files preserve names, images, values and quantities. Importing creates new copies; it does not replace existing cards.</p>
      <label>Custom-card file (.json)<input type="file" accept=".json,application/json" disabled={busy} onChange={e => setFile(e.target.files?.[0] ?? null)} /></label>
      <div className="button-row">
        <button disabled={busy || !file} onClick={() => void perform(async () => {
          if (!file || file.size > 2 * 1024 * 1024) throw new Error("Choose a JSON file smaller than 2 MiB.");
          const payload: unknown = JSON.parse(await file.text());
          const result = await apiRequest<{imported: number}>("/api/v1/custom-cards/import", {method:"POST", body:JSON.stringify(payload)});
          setFile(null); return `Imported ${result.imported} custom cards into your collection.`;
        })}>Import file</button>
        <button disabled={busy} onClick={() => void perform(async () => {
          const data = await apiRequest("/api/v1/custom-cards/export");
          const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:"application/json"}));
          const link = document.createElement("a"); link.href=url; link.download="cardvault-custom-cards.json"; link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000); return "Custom-card file downloaded.";
        })}>Export custom cards</button>
        <Link to="/collection/import">Standard collection CSV import</Link>
      </div>
    </section>
  </section>;
}
