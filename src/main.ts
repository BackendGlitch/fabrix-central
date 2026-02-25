import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useWebSocketAdapter(new WsAdapter(app));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors();

  const port = process.env.PORT ?? 4000;
  await app.listen(port);

  console.log(`Fabrix Central running on http://localhost:${port}`);
  console.log(`Health: http://localhost:${port}/health`);
  console.log(`Agent WS: ws://localhost:${port}/ws/agent`);
}
bootstrap();
