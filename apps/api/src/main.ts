import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? true });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`JobRadar API listening on port ${port}`);
}

void bootstrap();
