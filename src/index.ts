import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { ordersRouter } from './routes/orders';
import { refundsRouter } from './routes/refunds';
// import { BlockchainService } from './services/blockchainService';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Configure helmet with relaxed CSP for development
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
    },
  },
}));
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use('/public', express.static(path.join(process.cwd(), 'public')));

app.use('/api/orders', ordersRouter);
app.use('/api/refunds', refundsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/chains', (req, res) => {
  const chains = [
    { 
      id: 'BASE_SEPOLIA', 
      name: 'Base Sepolia', 
      network: 'testnet',
      faucetUrl: 'https://faucet.quicknode.com/base/sepolia',
      explorerUrl: 'https://sepolia.basescan.org'
    },
    { 
      id: 'ETHEREUM_SEPOLIA', 
      name: 'Ethereum Sepolia', 
      network: 'testnet',
      faucetUrl: 'https://sepoliafaucet.com',
      explorerUrl: 'https://sepolia.etherscan.io'
    },
  ];
  res.json(chains);
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function startServer() {
  try {
    // Start server first
    app.listen(port, () => {
      console.log(`StablePay API server running on port ${port}`);
      console.log(`Health check: http://localhost:${port}/api/health`);
    });

    // Try to start blockchain scanner (non-blocking)
    // Temporarily disabled due to Prisma prepared statement errors
    // try {
    //   const blockchainService = new BlockchainService();
    //   await blockchainService.startScanning();
    //   console.log('✅ Blockchain scanner started successfully!');
    // } catch (scannerError) {
    //   console.warn('⚠️  Blockchain scanner failed to start:', scannerError.message);
    //   console.warn('   API will work but payments won\'t be detected automatically');
    // }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();