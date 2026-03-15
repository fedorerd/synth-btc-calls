"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const NAV_ITEMS = [
  { href: "/", label: "Live Advisor" },
  { href: "/about", label: "How It Works" },
  { href: "/backtest", label: "Backtest" },
];

export function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const pathname = usePathname();

  return (
    <div className="mb-8 flex items-start justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex gap-2">
        {NAV_ITEMS.filter((item) => item.href !== pathname).map((item) => (
          <Link key={item.href} href={item.href}>
            <Button variant="outline" size="sm">{item.label}</Button>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PageFooter() {
  const linkClass = "text-foreground hover:underline";
  return (
    <div className="mt-8 space-y-2 border-t pt-4 text-center text-xs text-muted-foreground">
      <div>
        Powered by{" "}
        <a href="https://synthdata.co" target="_blank" rel="noopener noreferrer" className={linkClass}>Synth</a>
        {" "}&middot;{" "}
        <a href="https://polymarket.com" target="_blank" rel="noopener noreferrer" className={linkClass}>Polymarket</a>
        {" "}&middot;{" "}
        <a href="https://predexon.com" target="_blank" rel="noopener noreferrer" className={linkClass}>Predexon</a>
      </div>
      <div>
        <a href="https://preddy.trade" target="_blank" rel="noopener noreferrer" className={linkClass}>Trade on Preddy</a>
        {" "}&middot;{" "}
        Author: <a href="https://x.com/Fedoras_" target="_blank" rel="noopener noreferrer" className={linkClass}>fedoras</a>
        {" "}&middot;{" "}
        Not financial advice
      </div>
    </div>
  );
}
