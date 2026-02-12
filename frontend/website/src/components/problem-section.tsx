import { Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const excels = [
  'Governance & voting',
  'Treasury management',
  'Transparency & auditability',
  'Community alignment',
];

const struggles = [
  'Execution & delivery',
  'Cross-team coordination',
  'Measuring outcomes',
  '24/7 operations',
];

export function ProblemSection() {
  return (
    <section id="problem" className="py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-[family-name:var(--font-serif)] text-3xl font-bold tracking-tight sm:text-4xl">
            DAOs Are Great at Governance.
          </h2>
          <p className="mt-2 text-lg text-muted-foreground">
            But they struggle with execution.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Card variant="outline" className="border-emerald-500/30 text-left">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-emerald-400 mb-4">What DAOs Excel At</h3>
                <ul className="space-y-3">
                  {excels.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card variant="outline" className="border-red-500/30 text-left">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-red-400 mb-4">What DAOs Struggle With</h3>
                <ul className="space-y-3">
                  {struggles.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <X className="h-4 w-4 text-red-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <p className="mt-8 text-lg font-medium text-primary">
            Jinn is the execution layer.
          </p>
        </div>
      </div>
    </section>
  );
}
