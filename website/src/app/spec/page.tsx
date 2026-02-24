import fs from "fs";
import path from "path";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { SpecViewer } from "@/components/spec-viewer";

export const metadata = {
  title: "Specification",
  description: "ADW v0.1 — Full specification for the Agentic Document Web",
};

export default function SpecPage() {
  const specPath = path.join(process.cwd(), "..", "spec.md");
  const content = fs.readFileSync(specPath, "utf-8");

  return (
    <>
      <Nav />
      <div className="mx-auto max-w-7xl px-6 py-12">
        <SpecViewer content={content} />
      </div>
      <Footer />
    </>
  );
}
