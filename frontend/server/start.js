if (!/^24\./.test(process.versions.node)) {
  console.error('Decidefer requires Node.js 24 LTS with node:sqlite. Current version: ' + process.version);
  process.exitCode = 1;
} else {
  try {
    await import('node:sqlite');
  } catch {
    console.error('SQLite is unavailable. Install Node.js 24 LTS with the built-in node:sqlite module.');
    process.exitCode = 1;
  }
  if (!process.exitCode) {
    try {
      await import('./index.js');
    } catch (error) {
      console.error('Decidefer startup failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
