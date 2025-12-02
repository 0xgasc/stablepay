// Vercel serverless function wrapper for Express app
// Import the compiled Express app (use .default for ES module)
const app = require('../dist/index.js').default;

// Export the Express app as a Vercel serverless function
module.exports = app;
