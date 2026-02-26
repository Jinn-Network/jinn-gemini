"use client";

import { Nav } from "@/components/nav";
import { AnnouncementBanner } from "@/components/announcement-banner";
import { Hero } from "@/components/hero";
import { ProblemStatement } from "@/components/problem-statement";
import { HowItWorks } from "@/components/how-it-works";
import { LayersBento } from "@/components/layers-bento";
import { DocumentTypes } from "@/components/document-types";
import { TrustModel } from "@/components/trust-model";
import { CodeExample } from "@/components/code-example";
import { StandardsGrid } from "@/components/standards-grid";
import { GetStarted } from "@/components/get-started";
import { Footer } from "@/components/footer";

export default function Home() {
  return (
    <>
      <AnnouncementBanner />
      <Nav />
      <Hero />
      <ProblemStatement />
      <HowItWorks />
      <LayersBento />
      <DocumentTypes />
      <TrustModel />
      <CodeExample />
      <StandardsGrid />
      <GetStarted />
      <Footer />
    </>
  );
}
