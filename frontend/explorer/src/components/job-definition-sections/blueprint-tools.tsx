'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ReactMarkdown from 'react-markdown'
import { parseInvariants, getInvariantText } from '@/lib/invariant-utils'

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

    // Check for invariants (new schema) or assertions (legacy schema)
    const items = parseInvariants(parsed)
    if (items.length > 0) {
      blueprintRendering = (
        <div className="space-y-4">
          {items.map((item, idx) => {
            const text = getInvariantText(item)
            return (
              <Card key={item.id || idx}>
                <CardContent className="pt-4">
                  <div className="font-medium text-sm mb-2">{item.id}</div>
                  {text && (
                    <p className="text-sm text-muted-foreground mb-3">{text}</p>
                  )}
                  {item.description && (
                    <p className="text-sm text-muted-foreground mb-3">{item.description}</p>
                  )}
                  {item.measurement && (
                    <div className="text-xs bg-blue-50 dark:bg-blue-950 p-2 rounded mb-3">
                      <span className="font-medium text-blue-700 dark:text-blue-300">📏 Measurement:</span>{' '}
                      <span className="text-blue-600 dark:text-blue-400">{item.measurement}</span>
                    </div>
                  )}
                  {item.examples && (
                    <div className="space-y-2 text-xs">
                      {item.examples.do && item.examples.do.length > 0 && (
                        <div>
                          <div className="font-medium text-green-700 mb-1">✓ Do:</div>
                          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                            {item.examples.do.map((example, i) => (
                              <li key={i}>{example}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {item.examples.dont && item.examples.dont.length > 0 && (
                        <div>
                          <div className="font-medium text-red-700 mb-1">✗ Don&apos;t:</div>
                          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                            {item.examples.dont.map((example, i) => (
                              <li key={i}>{example}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                  {item.commentary && (
                    <div className="mt-3 pt-3 border-t">
                      <p className="text-xs text-muted-foreground italic">{item.commentary}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
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

