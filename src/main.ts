import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOriginsRaw = (process.env.CORS_ORIGINS ?? '*').trim();

  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  if (corsOriginsRaw === '*') {
    app.enableCors({ origin: '*' });
  } else {
    const corsOrigins = corsOriginsRaw
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    app.enableCors({
      origin: corsOrigins,
      credentials: true,
    });
  }

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  console.log(`Fabrix Central running on http://localhost:${port}`);
  console.log(`Health: http://localhost:${port}/health`);
  console.log(`Agent WS: ws://localhost:${port}/ws/agent`);
}
bootstrap();
