import type { Metadata } from "next";
import { PageShell } from "@/components/layout/page-shell";
import { PrivacyCenter } from "@/components/privacy/privacy-center";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <PageShell
      title="Privacy"
      description="Choose what is stored, what leaves the app, and which destinations may receive it. Conduit cannot verify a third-party provider's behavior; local endpoints are the only configuration that keeps content on your machine."
    >
      <PrivacyCenter />
    </PageShell>
  );
}
