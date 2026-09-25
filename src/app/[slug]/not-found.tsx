import Link from "next/link";

/** Spec 13: unknown or changed booking link. */
export default function BookingLinkNotFound() {
  return (
    <div className="flow-wrap">
      <div className="flow-card screen-in">
        <h1 className="font-display">{"This booking link doesn't exist"}</h1>
        <p className="sub">Check the link with your clinic. It may have changed.</p>
        <Link href="/" className="btn btn-ghost wide-btn">
          Go to BrightSmile
        </Link>
      </div>
    </div>
  );
}
