import type { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type AuthLayoutProps = {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Wider card (recovery codes, QR code). */
  wide?: boolean;
};

/** The centred card every sign-in screen sits in. */
export function AuthLayout({ title, description, children, wide }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className={wide ? "w-full max-w-lg" : "w-full max-w-sm"}>
        <p className="mb-4 text-center text-sm font-semibold tracking-wide text-muted-foreground">
          Warlock Devtools
        </p>
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </CardHeader>
          <CardContent className="grid gap-4">{children}</CardContent>
        </Card>
      </div>
    </main>
  );
}
