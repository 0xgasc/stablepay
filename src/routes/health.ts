import { Router, Request, Response } from 'express';
import { db } from '../config/database';
import { getEnv, isProduction } from '../utils/env';

const router = Router();

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  environment: string;
  version: string;
  checks: {
    database: {
      status: 'up' | 'down';
      latency?: number;
      error?: string;
    };
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
  };
}

/**
 * GET /health
 * Basic health check endpoint
 * Returns 200 if service is healthy
 */
router.get('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  const env = getEnv();

  try {
    // Check database connection
    let dbStatus: 'up' | 'down' = 'down';
    let dbLatency: number | undefined;
    let dbError: string | undefined;

    try {
      const dbStart = Date.now();
      await db.$queryRaw`SELECT 1`;
      dbLatency = Date.now() - dbStart;
      dbStatus = 'up';
    } catch (error) {
      dbError = error instanceof Error ? error.message : 'Unknown database error';
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    const memoryPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    // Determine overall status
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (dbStatus === 'down') {
      status = 'unhealthy';
    } else if (memoryPercentage > 90 || (dbLatency && dbLatency > 1000)) {
      status = 'degraded';
    }

    const healthResponse: HealthCheckResponse = {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        database: {
          status: dbStatus,
          latency: dbLatency,
          ...(dbError && { error: dbError }),
        },
        memory: {
          used: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
          total: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
          percentage: Math.round(memoryPercentage),
        },
      },
    };

    const statusCode = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
    return res.status(statusCode).json(healthResponse);
  } catch (error) {
    console.error('Health check error:', error);
    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

/**
 * GET /health/live
 * Liveness probe - is the service running?
 * Returns 200 if process is alive
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /health/ready
 * Readiness probe - is the service ready to accept traffic?
 * Returns 200 if database is connected
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Database connection failed',
    });
  }
});

/**
 * GET /health/metrics
 * Detailed metrics for monitoring (only in non-production)
 */
router.get('/metrics', (req: Request, res: Response) => {
  if (isProduction()) {
    return res.status(403).json({
      error: 'Metrics endpoint disabled in production',
    });
  }

  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  res.json({
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    },
    cpu: {
      user: cpuUsage.user,
      system: cpuUsage.system,
    },
    process: {
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch,
    },
  });
});

export const healthRouter = router;
