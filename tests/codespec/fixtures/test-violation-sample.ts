// This file contains deliberate violations for testing the autofix workflow

// VIOLATION: Hardcoded API key (obj3 - Minimize Harm)
const API_KEY = "sk_test_4eC39HqLyjWDarjtT1zdp7dc";

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
