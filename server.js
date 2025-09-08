import { createRequestHandler } from '@remix-run/node';
import { installGlobals } from '@remix-run/node';
import sourceMapSupport from 'source-map-support';

// Install globals for Node.js
installGlobals();

// Source map support for better error messages
sourceMapSupport.install();

// Import the built app
import * as build from './build/server/index.js';

const port = process.env.PORT || 3000;

const requestHandler = createRequestHandler(build, process.env.NODE_ENV);

const server = (await import('http')).createServer((req, res) => {
  // Set security headers
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  // Handle the request
  requestHandler(req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Prompify server running on port ${port}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔐 Auth disabled: ${process.env.AUTH_DISABLED}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});


