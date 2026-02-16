'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createVenture } from '@/app/actions';

const CATEGORIES = [
  'Growth',
  'Research',
  'Content',
  'Software',
  'Governance',
  'Other',
] as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function CreateVentureForm() {
  const router = useRouter();
  const { user } = usePrivy();
  const address = user?.wallet?.address;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [problem, setProblem] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const descriptionValid = description.trim().length >= 50;
  const isValid = name.trim() && descriptionValid && category && problem.trim();

  async function handleSubmit() {
    if (!address || !isValid) return;

    setIsSaving(true);
    try {
      const slug = slugify(name);
      const result = await createVenture({
        name: name.trim(),
        slug,
        description: description.trim(),
        category,
        problem: problem.trim(),
        owner_address: address,
      });

      if (result.error) {
        toast.error(result.error);
      } else {
        toast.success('Idea posted!');
        router.push(`/ventures/${slug}`);
      }
    } catch {
      toast.error('Failed to post idea');
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>Post an Idea</CardTitle>
        <CardDescription>
          Propose a venture. Define the problem, set success criteria, then launch a token to rally support.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="What's the venture called?"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isSaving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select value={category} onValueChange={setCategory} disabled={isSaving}>
            <SelectTrigger id="category">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>{cat}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="problem">Problem</Label>
          <Textarea
            id="problem"
            placeholder="What problem does this solve?"
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            rows={2}
            disabled={isSaving}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            placeholder="Describe the venture in detail (min 50 characters)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            disabled={isSaving}
          />
          <p className={`text-xs ${description.trim().length > 0 && !descriptionValid ? 'text-destructive' : 'text-muted-foreground'}`}>
            {description.trim().length}/50 characters minimum
          </p>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={isSaving || !isValid}
          className="w-full"
        >
          {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Post Idea
        </Button>
      </CardContent>
    </Card>
  );
}
