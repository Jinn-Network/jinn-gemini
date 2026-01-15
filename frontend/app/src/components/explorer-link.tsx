import { ExternalLink } from 'lucide-react';
import { getExplorerUrl } from '@/lib/featured-services';

interface ExplorerLinkProps {
  type: 'workstream' | 'request' | 'jobDefinitions' | 'templates';
  id: string;
  children: React.ReactNode;
  className?: string;
}

export function ExplorerLink({ type, id, children, className }: ExplorerLinkProps) {
  const href = getExplorerUrl(type, id);

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-primary hover:underline inline-flex items-center gap-1 ${className || ''}`}
    >
      {children}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}
