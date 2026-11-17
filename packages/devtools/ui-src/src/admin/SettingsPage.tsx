import { useState } from "react";
import { apiFetch } from "@/api/client";
import { useSession } from "@/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

/** Dashboard settings. For now: the switch that turns the dashboard off on every instance. */
export function SettingsPage() {
  const { markDisabled } = useSession();
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Disable the dashboard</CardTitle>
        <CardDescription>
          Closes the dashboard on every instance within seconds. It stays closed after a restart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          Disable the dashboard
        </Button>
      </CardContent>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Disable the dashboard?"
        description={
          <>
            <p>
              Every instance answers as if the page did not exist, and every session ends. Only
              someone with shell access can open it again: run <code>warlock devtools:enable</code>, or
              deploy with a new <code>DEVTOOLS_PATH</code>.
            </p>
          </>
        }
        confirmLabel="Disable the dashboard"
        destructive
        requireText="disable"
        onConfirm={async () => {
          await apiFetch("api/admin/disable", { method: "POST", body: { confirm: "disable" } });
          markDisabled();
        }}
      />
    </Card>
  );
}
