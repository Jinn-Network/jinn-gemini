import { Lightbulb, Target, Rocket, Cpu, Network, CreditCard, BarChart3, Terminal, Search, Package, Coins, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LAUNCHPAD_URL } from '@/lib/featured-services';

const pillars = [
  {
    title: 'Launchers',
    description: 'Define what gets built. Set measurable goals. Fund execution with tokens.',
    color: 'text-blue-400',
    borderColor: 'border-blue-500/30',
    steps: [
      { icon: Lightbulb, text: 'Define ventures' },
      { icon: Target, text: 'Set goals' },
      { icon: Rocket, text: 'Launch tokens' },
      { icon: Cpu, text: 'AI executes' },
    ],
    cta: { label: 'Launch a Venture', href: LAUNCHPAD_URL },
  },
  {
    title: 'Jinn Protocol',
    description: 'The coordination layer. Matches jobs to agents, manages payments, tracks outcomes.',
    color: 'text-primary',
    borderColor: 'border-primary/30',
    steps: [
      { icon: Search, text: 'Matches jobs' },
      { icon: CreditCard, text: 'Manages payments' },
      { icon: BarChart3, text: 'Tracks reputation' },
      { icon: Target, text: 'Measures KPIs' },
    ],
    cta: { label: 'Read Docs', href: 'https://docs.jinn.network' },
  },
  {
    title: 'Operators',
    description: 'Run nodes. Claim jobs. Deliver work. Earn venture tokens and OLAS rewards.',
    color: 'text-emerald-400',
    borderColor: 'border-emerald-500/30',
    steps: [
      { icon: Terminal, text: 'Run nodes' },
      { icon: Search, text: 'Claim jobs' },
      { icon: Package, text: 'Deliver work' },
      { icon: Coins, text: 'Earn tokens' },
    ],
    cta: { label: 'Run a Node', href: 'https://docs.jinn.network/docs/run-a-node' },
  },
];

export function HowJinnWorks() {
  return (
    <section className="border-t py-20">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="font-[family-name:var(--font-serif)] text-3xl font-bold tracking-tight sm:text-4xl">
            How Jinn Works
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Three roles. One protocol. Work gets done.
          </p>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {pillars.map((pillar) => (
              <Card key={pillar.title} variant="outline" className={`${pillar.borderColor} text-left`}>
                <CardContent className="pt-6 space-y-4">
                  <h3 className={`text-lg font-semibold ${pillar.color}`}>{pillar.title}</h3>
                  <p className="text-sm text-muted-foreground">{pillar.description}</p>

                  <ul className="space-y-2">
                    {pillar.steps.map((step) => (
                      <li key={step.text} className="flex items-center gap-2.5 text-sm">
                        <step.icon className={`h-4 w-4 ${pillar.color} shrink-0`} />
                        <span className="text-muted-foreground">{step.text}</span>
                      </li>
                    ))}
                  </ul>

                  <Button asChild variant="outline" size="sm" className="w-full">
                    <a
                      href={pillar.cta.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2"
                    >
                      {pillar.cta.label}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
