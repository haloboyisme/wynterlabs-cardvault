import { Link } from "react-router-dom";

export function NotFoundPage() {
  return <section className="state-panel"><p className="eyebrow">404</p><h1>This card is not in the deck.</h1><p>The page you requested does not exist.</p><Link className="button primary" to="/">Return home</Link></section>;
}
