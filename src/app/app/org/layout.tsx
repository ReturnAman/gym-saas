import type { ReactNode } from "react";

import { requireOrganizationContext } from "@/lib/server/authorization";

import { AppShell } from "./app-shell";

export default async function OrganizationLayout({ children }: { children: ReactNode }) {
  const { organization, membership } = await requireOrganizationContext();

  return (
    <AppShell organizationName={organization.name} role={membership.role}>
      {children}
    </AppShell>
  );
}
