import fs from "fs";
import path from "path";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import { SpecViewer } from "@/components/spec-viewer";

export const metadata = {
  title: "Intro",
  description: "ADW plain-language introduction",
};

export default function IntroPage() {
  const introPath = path.join(process.cwd(), "..", "intro.md");
  const content = fs.readFileSync(introPath, "utf-8");

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
