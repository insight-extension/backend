// Function to simulate a delay during tests and interactions with chain
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
