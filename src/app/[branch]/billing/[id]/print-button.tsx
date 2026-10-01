"use client";

import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
      Print receipt
    </Button>
  );
}
