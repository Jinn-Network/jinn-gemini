// This file contains deliberate violations for testing the autofix workflow

// Fixed: Load API key from environment variable
const API_KEY = process.env.API_KEY;
if (!API_KEY) throw new Error('API_KEY environment variable is required');

export async function fetchData() {
  const response = await fetch("https://api.example.com/data", {
    headers: {
      Authorization: `Bearer ${API_KEY}`
    }
  });
  return response.json();
}

// VIOLATION: Inconsistent error handling (obj1 - Orthodoxy)
export function processData(data: any) {
  try {
    return data.map((item: any) => item.value);
  } catch (e) {
    return null; // Silent failure, not following established error patterns
  }
}
