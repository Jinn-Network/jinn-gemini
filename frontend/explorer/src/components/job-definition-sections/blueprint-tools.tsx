'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ReactMarkdown from 'react-markdown'

interface JobDefinition {
  id: string
  name: string
  enabledTools?: string[]
  blueprint?: string
  promptContent?: string
}

interface BlueprintToolsProps {
  jobDefinition: JobDefinition
}

export function JobDefinitionBlueprintTools({ jobDefinition }: BlueprintToolsProps) {
  const blueprintContent = jobDefinition.blueprint || jobDefinition.promptContent || ''

  // Try to parse as JSON to check if it's structured
  let blueprintRendering = null
  try {
    const parsed = JSON.parse(blueprintContent)
    
    // If it has assertions, render them nicely
    if (parsed.assertions && Array.isArray(parsed.assertions)) {
      blueprintRendering = (
        <div className="space-y-4">
          {parsed.assertions.map((assertion: {
            id: string
            assertion?: string
            description?: string
            commentary?: string
            examples?: { do?: string[]; dont?: string[] }
          }, idx: number) => (
            <Card key={assertion.id || idx}>
              <CardContent className="pt-4">
                <div className="font-medium text-sm mb-2">{assertion.id}</div>
                {assertion.assertion && (
                  <p className="text-sm text-muted-foreground mb-3">{assertion.assertion}</p>
                )}
                {assertion.description && (
                  <p className="text-sm text-muted-foreground mb-3">{assertion.description}</p>
                )}
                {assertion.examples && (
                  <div className="space-y-2 text-xs">
                    {assertion.examples.do && assertion.examples.do.length > 0 && (
                      <div>
                        <div className="font-medium text-green-700 mb-1">✓ Do:</div>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          {assertion.examples.do.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {assertion.examples.dont && assertion.examples.dont.length > 0 && (
                      <div>
                        <div className="font-medium text-red-700 mb-1">✗ Don&apos;t:</div>
                        <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                          {assertion.examples.dont.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
                {assertion.commentary && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground italic">{assertion.commentary}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )
    } else {
      // Otherwise render as markdown
      blueprintRendering = (
        <div className="prose prose-sm max-w-none bg-muted p-4 rounded border">
          <ReactMarkdown>{typeof blueprintContent === 'string' ? blueprintContent : JSON.stringify(parsed, null, 2)}</ReactMarkdown>
        </div>
      )
    }
  } catch {
    // If not JSON, render as markdown
    blueprintRendering = (
      <div className="prose prose-sm max-w-none bg-muted p-4 rounded border">
        <ReactMarkdown>{blueprintContent}</ReactMarkdown>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Blueprint Card */}
      <Card>
        <CardHeader>
          <CardTitle>Blueprint</CardTitle>
        </CardHeader>
        <CardContent>
          {blueprintContent ? (
            blueprintRendering
          ) : (
            <div className="text-gray-500">[No blueprint content available]</div>
          )}
        </CardContent>
      </Card>

      {/* Enabled Tools */}
      {jobDefinition.enabledTools && jobDefinition.enabledTools.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Enabled Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {jobDefinition.enabledTools.map((tool, index) => (
                <Badge key={index} variant="outline" className="bg-primary/10 text-primary border-primary/30">
                  {tool}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

