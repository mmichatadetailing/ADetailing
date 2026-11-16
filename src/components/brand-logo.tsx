import Image from "next/image";
import { cn } from "@/lib/utils";

/** Official ADetailing wordmark, served locally to keep the workspace independent of the public site. */
export function BrandLogo({ className, inverted = false, priority = false }: { className?: string; inverted?: boolean; priority?: boolean }) {
  return <Image src="/brand/adetailing.svg" alt="ADetailing" width={166} height={78} priority={priority} className={cn("h-auto w-28 shrink-0 brightness-0", inverted && "invert", className)} />;
}
