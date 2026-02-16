import { Check, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const withoutJinn = [
  'Hire a team before you can start',
  'Raise funding or burn savings',
  'Manage contractors and freelancers',
  'Burn out doing everything yourself',
];

const withJinn = [
  'Define what success looks like',
  'Launch a token to rally support',
  'AI agents execute 24/7',
  'On-chain accountability for every action',
];

export function ProblemSection() {
  return (
    <section id="problem" className="py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-[family-name:var(--font-serif)] text-3xl font-bold tracking-tight sm:text-4xl">
            Great Ideas Deserve Better Than This
          </h2>

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            <Card variant="outline" className="border-red-500/30 text-left">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-red-400 mb-4">Starting Something Today</h3>
                <ul className="space-y-3">
                  {withoutJinn.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <X className="h-4 w-4 text-red-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card variant="outline" className="border-emerald-500/30 text-left">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-emerald-400 mb-4">Starting Something with Jinn</h3>
                <ul className="space-y-3">
                  {withJinn.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Check className="h-4 w-4 text-emerald-400 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          <p className="mt-8 text-lg font-medium text-primary">
            Execution is handled. You just need the idea.
          </p>
        </div>
      </div>
    </section>
  );
}
