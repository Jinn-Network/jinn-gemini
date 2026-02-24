import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
        <p>CC-BY-4.0 &middot; An open standard by Jinn Network</p>
        <div className="flex gap-6">
          <Link href="/intro" className="transition-colors hover:text-foreground">
            Intro
          </Link>
          <Link href="/spec" className="transition-colors hover:text-foreground">
            Spec
          </Link>
          <a
            href="https://github.com/Jinn-Network/adw-spec"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            GitHub
          </a>
          <a
            href="https://erc8004.org"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            ERC-8004
          </a>
        </div>
      </div>
    </footer>
  );
}
