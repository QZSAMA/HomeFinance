import type { Server } from 'http';
import app from './app';
import { ensureBucket } from './config/minio';
import { connectRedis } from './config/redis';
import { prisma } from './db/prisma';

export async function startServer(): Promise<Server> {
  const port = Number(process.env.PORT || 8080);
  const server = app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });

  await ensureBucket().catch(console.error);
  await connectRedis().catch((error) => {
    console.error('Redis 连接失败，缓存和限流功能将降级运行:', error instanceof Error ? error.message : error);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return server;
}

if (require.main === module) {
  void startServer();
}
