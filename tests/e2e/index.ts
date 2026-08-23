export async function run(): Promise<void> {
  await import("./activation.test.ts");
  await import("./configuration.test.ts");
  await import("./diagnostics.test.ts");
  await import("./code-actions.test.ts");
  const harness = await import("./harness.ts");
  await harness.testsDone();
}
