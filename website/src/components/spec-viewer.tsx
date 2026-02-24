"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeHighlight from "rehype-highlight";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { cn } from "@/lib/utils";

interface TocItem {
  id: string;
  text: string;
  level: number;
}

const INTERNAL_MARKDOWN_ROUTES: Record<string, string> = {
  "intro.md": "/intro",
  "spec.md": "/spec",
  "readme.md": "/",
};

function resolveMarkdownLink(href?: string): string | undefined {
  if (!href) return href;

  const normalized = href.toLowerCase().replace(/^\.\//, "");
  if (normalized in INTERNAL_MARKDOWN_ROUTES) {
    return INTERNAL_MARKDOWN_ROUTES[normalized];
  }

  return href;
}

function extractToc(markdown: string): TocItem[] {
  const headingRegex = /^(#{1,4})\s+(.+)$/gm;
  const items: TocItem[] = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const text = match[2].replace(/\*\*/g, "").trim();
    const id = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");
    items.push({ id, text, level: match[1].length });
  }
  return items;
}

function TocSidebar({
  items,
  activeId,
}: {
  items: TocItem[];
  activeId: string;
}) {
  return (
    <nav className="sticky top-20 hidden max-h-[calc(100vh-6rem)] w-64 shrink-0 overflow-y-auto lg:block">
      <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Table of Contents
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={cn(
                "block truncate rounded-md px-2.5 py-1.5 text-xs transition-all",
                item.level === 1 && "font-semibold",
                item.level === 2 && "pl-4",
                item.level === 3 && "pl-6",
                item.level === 4 && "pl-8",
                activeId === item.id
                  ? "bg-violet-500/10 text-violet-400"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function SpecViewer({ content }: { content: string }) {
  const toc = extractToc(content);
  const [activeId, setActiveId] = useState("");
  const observerRef = useRef<IntersectionObserver | null>(null);

  const setupObserver = useCallback(() => {
    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );

    document
      .querySelectorAll("h1[id], h2[id], h3[id], h4[id]")
      .forEach((el) => {
        observerRef.current?.observe(el);
      });
  }, []);

  useEffect(() => {
    const timer = setTimeout(setupObserver, 100);
    return () => {
      clearTimeout(timer);
      observerRef.current?.disconnect();
    };
  }, [setupObserver]);

  return (
    <div className="flex gap-8">
      <TocSidebar items={toc} activeId={activeId} />
      <article className="prose prose-invert min-w-0 max-w-4xl flex-1 prose-headings:font-mono prose-headings:tracking-tight prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline prose-code:text-sm prose-pre:glass prose-pre:rounded-xl prose-table:text-sm prose-th:text-xs prose-th:uppercase prose-th:tracking-wider">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[
            rehypeSlug,
            rehypeHighlight,
            [rehypeAutolinkHeadings, { behavior: "wrap" }],
          ]}
          components={{
            a: ({ href, children, ...props }) => {
              const resolvedHref = resolveMarkdownLink(href);
              const isExternal = resolvedHref
                ? /^https?:\/\//i.test(resolvedHref)
                : false;

              return (
                <a
                  {...props}
                  href={resolvedHref}
                  target={isExternal ? "_blank" : undefined}
                  rel={isExternal ? "noopener noreferrer" : undefined}
                >
                  {children}
                </a>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </article>
    </div>
  );
}
