import type { ReactNode } from "react";
import { BrandMark } from "@/components/common/BrandMark";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type AuthLayoutProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Wider card (recovery codes, QR code). */
  wide?: boolean;
};

/** The centred card every sign-in screen sits in, under the product mark. */
export function AuthLayout({ title, description, children, wide }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_oklab,var(--brand)_14%,transparent),transparent)] p-4">
      <div className={wide ? "w-full max-w-lg" : "w-full max-w-sm"}>
        <div className="mb-5 flex flex-col items-center gap-2">
          <BrandMark className="size-11 rounded-xl" />
          <p className="text-sm font-semibold tracking-tight">Warlock Devtools</p>
        </div>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="grid gap-4">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
