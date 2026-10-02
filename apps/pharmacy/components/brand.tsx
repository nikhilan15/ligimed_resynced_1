import Link from 'next/link';

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="LigiMed home">
      <span className="brand-icon" aria-hidden="true">
        ✚
      </span>
      <span>
        Ligi<span className="brand-light">Med</span>
        <small>PHARMACY</small>
      </span>
    </Link>
  );
}
