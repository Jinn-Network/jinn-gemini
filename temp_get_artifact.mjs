
import { getDetails } from './packages/metacog-mcp/src/tools/get-details.ts';

async function run() {
    const artifactId = process.argv[2];
    if (!artifactId) {
        console.error("Usage: node temp_get_artifact.mjs <artifact_id>");
        process.exit(1);
    }

    const params = {
        table_name: 'artifacts',
        ids: [artifactId],
    };

    const result = await getDetails(params);
    if (result.content && result.content.length > 0 && result.content[0].type === 'text') {
        console.log(result.content[0].text);
    } else {
        console.error("Failed to retrieve artifact content or content is not text.");
    }
}

run();
