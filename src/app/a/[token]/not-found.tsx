/** An unknown or mistyped patient link. */
export default function PatientLinkNotFound() {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{"This link doesn't work"}</h1>
        <p className="sub">Check the text from your clinic, or call them.</p>
      </div>
    </div>
  );
}
