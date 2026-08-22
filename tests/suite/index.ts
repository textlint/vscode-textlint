export async function run(): Promise<void> {
  const testModule = await import("./extension.test.ts");
  await testModule.testsDone;
}
