import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import type { AppInvariantWithMeasurement } from '@/lib/invariant-utils';
import { InvariantCard } from '@jinn/shared-ui';

interface InvariantListProps {
  invariants: AppInvariantWithMeasurement[];
}

export function InvariantList({ invariants }: InvariantListProps) {
  if (invariants.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No invariants found in blueprint
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invariants</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {invariants.map((inv) => (
          <InvariantCard
            key={inv.id}
            invariant={inv.invariant}
            measurement={inv.measurement}
            status={inv.status}
          />
        ))}
      </CardContent>
    </Card>
  );
}
