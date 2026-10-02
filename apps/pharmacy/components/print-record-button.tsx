'use client';

export function PrintRecordButton() {
  return (
    <button type="button" className="customers-primary" onClick={() => window.print()}>
      Print internal record
    </button>
  );
}
